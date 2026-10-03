import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "../firebase";
import { useNavigate } from "react-router-dom";
import { Landmark, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { DataWarnings } from "../components/ReportControls";
import { attributePayments, accountTotals, isCapped, isLive } from "../utils/reporting";

export default function BankCash() {
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [errors, setErrors] = useState({});
  const [capped, setCapped] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fail = (name) => (err) => {
      console.error(`BankCash ${name} error:`, err);
      setErrors((e) => ({ ...e, [name]: err?.message || "Could not load" }));
    };
    const u1 = onSnapshot(collection(db, "accounts"), snap =>
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => isLive(a) && (a.subType === "Bank & Cash" || a.type === "Assets"))),
      fail("accounts")
    );
    const u2 = onSnapshot(collection(db, "payments"), snap => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCapped(isCapped(snap.size));
    }, fail("payments"));
    return () => { u1(); u2(); };
  }, []);
  // Payments are matched to accounts by account id, falling back to the
  // name only for older rows, so renaming an account keeps its history
  // and two accounts with the same name cannot double count.
  const { rowsByAccount, unmatched, duplicateNames } = useMemo(() => {
    const r = attributePayments(accounts, payments);
    return { rowsByAccount: r.byAccount, unmatched: r.unmatched, duplicateNames: r.duplicateNames };
  }, [accounts, payments]);

  const totalsFor = (acc) => accountTotals(acc, rowsByAccount.get(acc.id));
  const totalBalance = accounts.reduce((s, a) => s + totalsFor(a).balance, 0);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Bank & Cash Accounts</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
          Total Balance: <strong style={{ color: "var(--primary)", fontSize: 16 }}>Rs. {totalBalance.toLocaleString()}</strong>
        </p>
      </div>

      <DataWarnings capped={capped ? ["payments"] : []} errors={errors} />
      {(unmatched.length > 0 || duplicateNames.length > 0) && (
        <div role="alert" style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 13 }}>
          {unmatched.length > 0 && <div>{unmatched.length} payment{unmatched.length === 1 ? "" : "s"} refer to an account that no longer exists (renamed or deleted) and are not in any balance below.</div>}
          {duplicateNames.length > 0 && <div>More than one account is named {duplicateNames.join(", ")}. Payments recorded by name are counted once, against the first of them.</div>}
        </div>
      )}

      {accounts.length === 0 && (
        <div style={{ background: "white", borderRadius: 12, padding: 48, textAlign: "center", border: "1px solid var(--border)" }}>
          <Landmark size={40} color="var(--text-muted)" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "var(--text-muted)" }}>No bank or cash accounts yet.</p>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>Go to Chart of Accounts and add accounts with sub-type "Bank & Cash".</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {accounts.map(acc => {
          const { balance, inflow, outflow, count } = totalsFor(acc);
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
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{count} transactions</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}