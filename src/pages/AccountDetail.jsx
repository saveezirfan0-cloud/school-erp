import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from "../firebase";
import { useParams, useNavigate } from "react-router-dom";
import ExportMenu from "../components/UI/ExportMenu";
import { useUser } from "../context/UserContext";
import { ArrowLeft, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { logActivity } from "../utils/auditLog";
import { DataWarnings } from "../components/ReportControls";
import { attributePayments, accountTotals, isCapped, isLive, todayLocal, toYmd, round2 } from "../utils/reporting";

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { can } = useUser();
  const [account, setAccount] = useState(null);
  const [payments, setPayments] = useState([]);
  const [showTransfer, setShowTransfer] = useState(false);
  const [allAccounts, setAllAccounts] = useState([]);
  const [transfer, setTransfer] = useState({ toAccount: "", amount: "", date: todayLocal(), description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [capped, setCapped] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const fail = (name) => (err) => {
      console.error(`AccountDetail ${name} error:`, err);
      setErrors((e) => ({ ...e, [name]: err?.message || "Could not load" }));
    };
    const u1 = onSnapshot(collection(db, "accounts"), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isLive);
      setAllAccounts(all);
      setAccount(all.find(a => a.id === accountId));
    }, fail("accounts"));
    const u2 = onSnapshot(collection(db, "payments"), snap => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCapped(isCapped(snap.size));
    }, fail("payments"));
    return () => { u1(); u2(); };
  }, [accountId]);

  if (!account) return <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading...</div>;

  // Transactions are matched by account id, with the name as a fallback
  // for older rows, so renaming the account does not lose its history.
  const mine = attributePayments(allAccounts, payments).byAccount.get(account.id) || [];
  const txns = [...mine].sort((a, b) =>
    (toYmd(b.date) || "").localeCompare(toYmd(a.date) || "") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const { inflow, outflow, balance } = accountTotals(account, mine);

  // Running balance
  let running = Number(account.balance || 0);
  const txnsWithBalance = [...txns].reverse().map(t => {
    if (t.type === "cash_in") running += Number(t.amount);
    else running -= Number(t.amount);
    return { ...t, runningBalance: running };
  }).reverse();

  // Account statement, oldest first so the running balance reads top to bottom.
  const getExportData = () => {
    const ordered = [...txnsWithBalance].reverse();
    const num = (v) => Number(v || 0);
    return {
      headers: ["Date", "Description", "Category", "Reference", "In", "Out", "Balance"],
      rows: ordered.map(t => [t.date, t.description, t.category, t.reference || "", t.type === "cash_in" ? num(t.amount) : "", t.type === "cash_out" ? num(t.amount) : "", t.runningBalance]),
      pdfRows: ordered.map(t => [t.date, t.description, t.category, t.reference || "", t.type === "cash_in" ? `Rs. ${num(t.amount).toLocaleString()}` : "", t.type === "cash_out" ? `Rs. ${num(t.amount).toLocaleString()}` : "", `Rs. ${t.runningBalance.toLocaleString()}`]),
    };
  };

  // Two legs, written one after the other (the shim has no transaction).
  // If the second leg fails the first is removed again so money never
  // leaves one account without arriving in the other.
  const handleTransfer = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const amount = round2(transfer.amount);
    const target = allAccounts.find(a => a.id === transfer.toAccount);
    if (!target) return toast.error("Choose the account to transfer to");
    if (target.id === account.id) return toast.error("Choose a different account");
    if (!(amount > 0)) return toast.error("Enter an amount greater than zero");
    const date = toYmd(transfer.date) || todayLocal();
    const ref = `TRF-${(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).slice(0, 8)}`;
    setSubmitting(true);
    let firstLeg = null;
    try {
      firstLeg = await addDoc(collection(db, "payments"), {
        type: "cash_out", account: account.name, accountId: account.id, amount,
        date, description: `Transfer to ${target.name}: ${transfer.description}`,
        category: "Bank Transfer", reference: ref, createdAt: serverTimestamp()
      });
      await addDoc(collection(db, "payments"), {
        type: "cash_in", account: target.name, accountId: target.id, amount,
        date, description: `Transfer from ${account.name}: ${transfer.description}`,
        category: "Bank Transfer", reference: ref, createdAt: serverTimestamp()
      });
      logActivity("transferred", "Bank & Cash", `${ref} Rs. ${amount.toLocaleString()} from ${account.name} to ${target.name} on ${date}`);
      toast.success("Transfer recorded");
      setShowTransfer(false);
      setTransfer({ toAccount: "", amount: "", date: todayLocal(), description: "" });
    } catch (err) {
      let undone = false;
      if (firstLeg) {
        try { await deleteDoc(doc(db, "payments", firstLeg.id)); undone = true; } catch { /* reported below */ }
      }
      toast.error(firstLeg && !undone
        ? `Transfer failed half-way (${ref}). Check Payments for the Rs. ${amount.toLocaleString()} cash-out from ${account.name} and fix it.`
        : (err?.message || "Transfer failed. Nothing was recorded."));
      logActivity("transfer failed", "Bank & Cash", `${ref} Rs. ${amount.toLocaleString()} ${account.name} to ${target.name}${firstLeg && !undone ? " (first leg NOT undone)" : ""}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button onClick={() => navigate("/bank-cash")}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14, marginBottom: 20 }}>
        <ArrowLeft size={16} /> Back to Accounts
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{account.name}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{account.code} — {account.subType}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {can("canExport") && <ExportMenu filename={`account-${account.code || account.name}`} title={`Account Statement - ${account.name}`} getData={getExportData} disabled={txns.length === 0} pdfOptions={{ subtitle: `Balance Rs. ${balance.toLocaleString()}` }} />}
          <button onClick={() => setShowTransfer(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Transfer Funds
          </button>
        </div>
      </div>

      <DataWarnings capped={capped ? ["payments"] : []} errors={errors} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Current Balance", value: balance, color: "var(--primary)" },
          { label: "Opening Balance", value: Number(account.balance || 0), color: "#475569" },
          { label: "Total In", value: inflow, color: "#10b981" },
          { label: "Total Out", value: outflow, color: "#ef4444" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>Rs. {value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15 }}>
          Transaction History
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Date", "Description", "Category", "Reference", "In", "Out", "Balance"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txnsWithBalance.map(t => (
              <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>{t.date}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500 }}>{t.description}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>{t.category}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace" }}>{t.reference || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#10b981", fontWeight: 600 }}>
                  {t.type === "cash_in" ? `Rs. ${Number(t.amount).toLocaleString()}` : "—"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444", fontWeight: 600 }}>
                  {t.type === "cash_out" ? `Rs. ${Number(t.amount).toLocaleString()}` : "—"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: t.runningBalance >= 0 ? "var(--primary)" : "#ef4444" }}>
                  Rs. {t.runningBalance.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {txns.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No transactions yet for this account</div>}
      </div>

      {showTransfer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, width: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Transfer Funds</h3>
              <button onClick={() => setShowTransfer(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleTransfer}>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ padding: 12, background: "var(--primary-light)", borderRadius: 8, fontSize: 14 }}>
                  From: <strong>{account.name}</strong> — Balance: <strong>Rs. {balance.toLocaleString()}</strong>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Transfer To</label>
                  <select value={transfer.toAccount} onChange={e => setTransfer(p => ({ ...p, toAccount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Select account</option>
                    {allAccounts.filter(a => a.id !== accountId && (a.subType === "Bank & Cash" || a.type === "Assets")).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount (Rs.)</label>
                  <input type="number" min="0.01" step="0.01" value={transfer.amount} onChange={e => setTransfer(p => ({ ...p, amount: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Date</label>
                  <input type="date" value={transfer.date} onChange={e => setTransfer(p => ({ ...p, date: e.target.value }))} required
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                  <input value={transfer.description} onChange={e => setTransfer(p => ({ ...p, description: e.target.value }))} placeholder="Reason for transfer"
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowTransfer(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ padding: "10px 20px", background: submitting ? "#c4a0a8" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "default" : "pointer", fontWeight: 600 }}>{submitting ? "Transferring…" : "Transfer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}