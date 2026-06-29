import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "../firebase";
import { useNavigate } from "react-router-dom";
import { Landmark, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";

export default function BankCash() {
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "accounts"), snap =>
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a.subType === "Bank & Cash" || a.type === "Assets"))
    );
    const u2 = onSnapshot(collection(db, "payments"), snap =>
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); };
  }, []);

  const getAccountBalance = (accountName) => {
    const opening = accounts.find(a => a.name === accountName)?.balance || 0;
    const txns = payments.filter(p => p.account === accountName);
    const inflow = txns.filter(p => p.type === "cash_in").reduce((s, p) => s + Number(p.amount), 0);
    const outflow = txns.filter(p => p.type === "cash_out").reduce((s, p) => s + Number(p.amount), 0);
    return Number(opening) + inflow - outflow;
  };

  const totalBalance = accounts.reduce((s, a) => s + getAccountBalance(a.name), 0);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Bank & Cash Accounts</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
          Total Balance: <strong style={{ color: "var(--primary)", fontSize: 16 }}>Rs. {totalBalance.toLocaleString()}</strong>
        </p>
      </div>

      {accounts.length === 0 && (
        <div style={{ background: "white", borderRadius: 12, padding: 48, textAlign: "center", border: "1px solid var(--border)" }}>
          <Landmark size={40} color="var(--text-muted)" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "var(--text-muted)" }}>No bank or cash accounts yet.</p>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>Go to Chart of Accounts and add accounts with sub-type "Bank & Cash".</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {accounts.map(acc => {
          const balance = getAccountBalance(acc.name);
          const txns = payments.filter(p => p.account === acc.name);
          const inflow = txns.filter(p => p.type === "cash_in").reduce((s, p) => s + Number(p.amount), 0);
          const outflow = txns.filter(p => p.type === "cash_out").reduce((s, p) => s + Number(p.amount), 0);
          return (
            <div key={acc.id} style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)", cursor: "pointer", transition: "box-shadow 0.15s" }}
              onClick={() => navigate(`/bank-cash/${acc.id}`)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, background: "var(--primary-light)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Landmark size={20} color="var(--primary)" />
                </div>
                <ArrowRight size={16} color="var(--text-muted)" />
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>{acc.code} — {acc.subType}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{acc.name}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: balance >= 0 ? "var(--primary)" : "#ef4444", marginBottom: 16 }}>
                Rs. {balance.toLocaleString()}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <TrendingUp size={13} color="#10b981" />
                  <span style={{ color: "#10b981", fontWeight: 600 }}>Rs. {inflow.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <TrendingDown size={13} color="#ef4444" />
                  <span style={{ color: "#ef4444", fontWeight: 600 }}>Rs. {outflow.toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{txns.length} transactions</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}