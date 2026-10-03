// Balance Sheet and Books Check tabs for Reports (ACC-06).
//
// This system is a single-entry cash book beside source documents, not a
// general ledger, so these tabs say exactly what they can and cannot
// prove. The Books Check is the control that surfaces invoices marked
// paid with no money in the books (ACC-01) and entries that do not tie.

import React, { useMemo } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Download } from "lucide-react";
import { useUser } from "../context/UserContext";
import { exportToCSV } from "../utils/exportUtils";
import { DataWarnings, money } from "../components/ReportControls";
import {
  balanceSheet, trialBalance, invoicesWithoutLedger, reversalIntegrity, transferBalance,
  docsWithoutLedger, payslipAmount, num,
} from "../utils/reporting";

export const BOOK_COLLECTIONS = ["accounts", "journals", "payments", "invoices", "payslips", "expenses"];

const card = { background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 };
const head = { padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "#f8fafc" };
const th = { padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" };
const td = { padding: "9px 14px", fontSize: 13, borderTop: "1px solid var(--border)" };

function Notice({ tone = "amber", children }) {
  const t = {
    amber: ["#fffbeb", "#fcd34d", "#92400e"],
    red: ["#fef2f2", "#fca5a5", "#991b1b"],
    green: ["#ecfdf5", "#6ee7b7", "#065f46"],
  }[tone];
  return <div style={{ padding: "10px 14px", borderRadius: 10, background: t[0], border: `1px solid ${t[1]}`, color: t[2], fontSize: 13, margin: "12px 24px" }}>{children}</div>;
}

// ------------------------------------------------------------------
export function BalanceSheetTab({ books, branch }) {
  const { data, loading, capped, errors } = books;
  const bs = useMemo(
    () => balanceSheet({ accounts: data.accounts || [], journals: data.journals || [], payments: data.payments || [] }),
    [data]
  );
  if (loading || !data.accounts) return <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading…</div>;

  const columns = [
    { title: "Assets", color: "#10b981", sections: [["Assets", bs.assets]], total: bs.assets.total },
    {
      title: "Liabilities & Equity", color: "#4f46e5",
      sections: [["Liabilities", bs.liabilities], ["Equity", bs.equity]],
      total: bs.rightTotal,
    },
  ];

  return (
    <div>
      <DataWarnings capped={capped} errors={errors} />
      <div style={card}>
        <div style={head}>
          <h3 style={{ fontWeight: 700, fontSize: 16 }}>Balance Sheet (derived, cash basis)</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            Built from opening balances in the Chart of Accounts, journal entries, and Bank &amp; Cash movements, as of today.
          </p>
        </div>
        <Notice tone="amber">
          Limits: unpaid fees (receivables), unpaid payslips and unpaid expenses are not accounts in this system, so they are not on this
          sheet. Bank &amp; Cash movements have no counter-account, so they appear as one derived line instead of being split into income and
          expense accounts. {branch !== "all" && "Accounts are not split by branch, so this always covers the whole institute."}
        </Notice>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {columns.map(({ title, color, sections, total }) => (
            <div key={title} style={{ padding: 24, borderRight: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 16 }}>{title}</div>
              {sections.every(([, s]) => s.items.length === 0) && (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No accounts of this type. Add them in Chart of Accounts.</div>
              )}
              {sections.map(([name, s]) => s.items.map(({ account, value }) => (
                <div key={account.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                  <span style={{ color: "var(--text-muted)" }}>{account.code} — {account.name}{sections.length > 1 ? ` (${name})` : ""}</span>
                  <span style={{ fontWeight: 600 }}>{money(value)}</span>
                </div>
              )))}
              {title !== "Assets" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span style={{ color: "var(--text-muted)" }}>Earnings from Income / Expense accounts</span>
                    <span style={{ fontWeight: 600 }}>{money(bs.earnings)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                    <span style={{ color: "var(--text-muted)" }}>Net cash movement not booked to accounts (derived)</span>
                    <span style={{ fontWeight: 600 }}>{money(bs.unbookedCash)}</span>
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700, fontSize: 15 }}>
                <span>Total {title}</span>
                <span style={{ color }}>{money(total)}</span>
              </div>
            </div>
          ))}
        </div>
        {bs.difference === 0 ? (
          <Notice tone="green">Assets equal Liabilities + Equity.</Notice>
        ) : (
          <Notice tone="red">
            <strong>Does not balance: difference {money(Math.abs(bs.difference))}.</strong>{" "}
            {bs.difference > 0 ? "Assets exceed" : "Liabilities and equity exceed"} the other side. With these inputs the difference equals the
            gap in the opening balances (see Books Check). Opening balances in the Chart of Accounts need an equity or retained-earnings account to offset them.
          </Notice>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
const STATUS = {
  ok: { Icon: CheckCircle2, color: "#059669", label: "OK" },
  warn: { Icon: AlertTriangle, color: "#d97706", label: "Review" },
  fail: { Icon: XCircle, color: "#dc2626", label: "Problem" },
};

function CheckBlock({ status, title, summary, children }) {
  const { Icon, color, label } = STATUS[status];
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ padding: "14px 20px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Icon size={20} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title} <span style={{ fontSize: 11, fontWeight: 700, color, marginLeft: 6 }}>{label}</span></div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{summary}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

const MAX_SHOWN = 50;

export function BooksCheckTab({ books, branch, branchName }) {
  const { can } = useUser();
  const { data, loading, capped, errors } = books;

  const result = useMemo(() => {
    const accounts = data.accounts || [], journals = data.journals || [], payments = data.payments || [];
    const invoices = data.invoices || [], payslips = data.payslips || [], expenses = data.expenses || [];
    const tb = trialBalance({ accounts, journals, payments });
    return {
      tb,
      paidNoLedger: invoicesWithoutLedger(invoices, payments, { branch }),
      reversal: reversalIntegrity(payments),
      transfers: transferBalance(payments),
      payslipGaps: docsWithoutLedger(payslips, payments, "payslip", (p) => String(p.status).toLowerCase() === "paid", payslipAmount),
      expenseGaps: docsWithoutLedger(expenses, payments, "expense", (e) => !!e.paidAccount, (e) => num(e.amount)),
    };
  }, [data, branch]);

  if (loading || !data.accounts) return <div style={{ padding: 40, color: "var(--text-muted)" }}>Loading…</div>;
  const { tb, paidNoLedger, reversal, transfers, payslipGaps, expenseGaps } = result;
  const noLedgerTotal = paidNoLedger.reduce((s, r) => s + r.diff, 0);

  const exportGaps = () => exportToCSV("invoices-paid-without-ledger-entry",
    ["Student", "Invoice id", "Status", "Branch", "Paid date", "Claimed paid", "Posted in ledger", "Difference", "Issue"],
    paidNoLedger.map((r) => [r.studentName, r.id, r.status, r.branchId || "main", r.date, r.claimed, r.posted, r.diff,
      r.kind === "no_ledger" ? "No ledger entry" : r.kind === "short" ? "Ledger short" : "Ledger higher than invoice"]));

  return (
    <div>
      <DataWarnings capped={capped} errors={errors} />
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
        Checks whether the posted entries agree with each other. Invoice checks follow the branch selector ({branchName}); everything else covers the whole institute.
        A clean result is only meaningful if no data warning is shown above.
      </p>

      <CheckBlock
        status={paidNoLedger.length === 0 ? "ok" : "fail"}
        title="Invoices marked paid with no matching ledger entry"
        summary={paidNoLedger.length === 0
          ? "Every paid or part-paid invoice has matching money in Bank & Cash."
          : `${paidNoLedger.length} invoice${paidNoLedger.length === 1 ? "" : "s"}, ${money(noLedgerTotal)} not backed by a Bank & Cash entry. Money may have been collected but never banked, or the invoice was marked paid by hand.`}
      >
        {paidNoLedger.length > 0 && (
          <>
            <div style={{ padding: "0 20px 10px" }}>
              {can("canExport") && (
                <button onClick={exportGaps} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13 }}>
                  <Download size={14} /> CSV
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Student", "Status", "Paid date", "Claimed", "In ledger", "Difference"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {paidNoLedger.slice(0, MAX_SHOWN).map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{r.studentName || r.id}</td>
                      <td style={td}>{r.status}</td>
                      <td style={td}>{r.date || "—"}</td>
                      <td style={td}>{money(r.claimed)}</td>
                      <td style={td}>{money(r.posted)}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#dc2626" }}>{money(r.diff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paidNoLedger.length > MAX_SHOWN && <div style={{ padding: "8px 20px", fontSize: 12, color: "var(--text-muted)" }}>Showing {MAX_SHOWN} of {paidNoLedger.length}. Export the CSV for the full list.</div>}
            </div>
          </>
        )}
      </CheckBlock>

      <CheckBlock
        status={tb.journalProblems.length === 0 ? "ok" : "fail"}
        title="Journal entries balance"
        summary={tb.journalProblems.length === 0
          ? `${tb.postedJournals} journal entr${tb.postedJournals === 1 ? "y" : "ies"} each post equal debit and credit (total ${money(tb.journalDebit)}).`
          : `${tb.journalProblems.length} journal entr${tb.journalProblems.length === 1 ? "y" : "ies"} cannot be posted and are excluded from the Balance Sheet.`}
      >
        {tb.journalProblems.slice(0, MAX_SHOWN).map((p) => (
          <div key={p.id} style={{ ...td, paddingLeft: 52 }}>
            {p.journal.reference || p.journal.description || p.id}: {p.issue} ({money(p.journal.amount)})
          </div>
        ))}
      </CheckBlock>

      <CheckBlock
        status={tb.openingDiff === 0 ? "ok" : "warn"}
        title="Opening balances: debits equal credits"
        summary={tb.openingDiff === 0
          ? `Debit-side and credit-side opening balances both total ${money(tb.openingDebit)}.`
          : `Debit-side accounts (assets, expenses) total ${money(tb.openingDebit)}; credit-side accounts (liabilities, equity, income) total ${money(tb.openingCredit)}. Difference ${money(Math.abs(tb.openingDiff))}. Opening balances were entered without an offsetting equity account.`}
      />

      <CheckBlock
        status={reversal.length === 0 ? "ok" : "fail"}
        title="Reversals are paired"
        summary={reversal.length === 0
          ? "Every reversed payment has its reversing entry and vice versa."
          : `${reversal.length} payment${reversal.length === 1 ? "" : "s"} have a missing or inconsistent reversal. Bank balances may be overstated or understated.`}
      >
        {reversal.slice(0, MAX_SHOWN).map((p) => (
          <div key={p.id} style={{ ...td, paddingLeft: 52 }}>{p.payment.date} · {p.payment.account} · {money(p.payment.amount)} — {p.issue}</div>
        ))}
      </CheckBlock>

      <CheckBlock
        status={transfers.diff === 0 ? "ok" : "fail"}
        title="Fund transfers net to zero"
        summary={transfers.diff === 0
          ? `Transfers in and out both total ${money(transfers.in)}.`
          : `Transfers in ${money(transfers.in)} versus out ${money(transfers.out)}: one leg of a transfer is missing (difference ${money(Math.abs(transfers.diff))}).`}
      />

      <CheckBlock
        status={payslipGaps.length === 0 && expenseGaps.length === 0 ? "ok" : "warn"}
        title="Paid payslips and expenses have a cash-out entry"
        summary={payslipGaps.length === 0 && expenseGaps.length === 0
          ? "Every paid payslip, and every expense with a paid-from account, has matching Bank & Cash money."
          : `${payslipGaps.length} payslip${payslipGaps.length === 1 ? "" : "s"} and ${expenseGaps.length} expense${expenseGaps.length === 1 ? "" : "s"} do not match the cash book.`}
      >
        {[...payslipGaps.map((g) => ({ ...g, label: `Payslip ${g.doc.employeeName || g.id}` })),
          ...expenseGaps.map((g) => ({ ...g, label: `Expense ${g.doc.description || g.id}` }))].slice(0, MAX_SHOWN).map((g) => (
          <div key={g.label + g.id} style={{ ...td, paddingLeft: 52 }}>{g.label}: expected {money(g.amount)}, in cash book {money(g.posted)}</div>
        ))}
      </CheckBlock>

      <CheckBlock
        status={tb.unmatchedPayments.length === 0 && tb.duplicateNames.length === 0 && tb.unknownType.length === 0 ? "ok" : "warn"}
        title="Payments point at real accounts"
        summary={
          tb.unmatchedPayments.length === 0 && tb.duplicateNames.length === 0 && tb.unknownType.length === 0
            ? "Every payment matches one account."
            : [
              tb.unmatchedPayments.length ? `${tb.unmatchedPayments.length} payment(s) name an account that no longer exists (renamed or deleted), total ${money(tb.unmatchedPayments.reduce((s, p) => s + (p.type === "cash_in" ? num(p.amount) : -num(p.amount)), 0))} net. They are missing from every balance.` : "",
              tb.duplicateNames.length ? `Duplicate account names: ${tb.duplicateNames.join(", ")}.` : "",
              tb.unknownType.length ? `${tb.unknownType.length} account(s) have no valid type.` : "",
            ].filter(Boolean).join(" ")
        }
      />
    </div>
  );
}
