import React, { useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Wallet, Scale, Receipt } from "lucide-react";
import { fmtNum, fmtMoney, rangeLabel, isSingleMonth } from "../../utils/monthlyStatement";
import { pick, tr, periodLabel } from "../../config/reportI18n";
import { card, Delta, StatCard, BudgetLine } from "./reportUi";

// One column of the statement (Income or Expense): grouped sections with
// subtotals, share bars, budgets and a per-branch split under each head.
// Clicking a head opens its records (when `onDrill` is given).
function Section({ title, tone, section, color, tint, emptyText, options, lang, onDrill }) {
  const [closed, setClosed] = useState({});
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 15 }}>{title}</h3>
          {section.budgetTotal > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
              {tr(lang, "budget")} {fmtNum(section.budgetTotal)} · {Math.round((section.total / section.budgetTotal) * 100)}%
            </div>
          )}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color }}>Rs. {fmtNum(section.total)}</div>
      </div>

      {section.groups.length === 0 && (
        <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{emptyText}</div>
      )}

      {section.groups.map((g) => {
        const share = section.total ? Math.round((g.total / section.total) * 100) : 0;
        const isClosed = closed[g.key];
        return (
          <div key={g.key} style={{ borderBottom: "1px solid var(--border)" }}>
            <button onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              style={{ width: "100%", textAlign: "inherit", background: tint, border: "none", cursor: "pointer", padding: "11px 20px", display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ChevronDown size={15} color="var(--primary)" style={{ transform: isClosed ? "rotate(-90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: "var(--sidebar-bg)" }}>
                  {pick(lang, g.label, g.labelUr)}
                  {g.excluded && <span title="Shown for reference — not part of the total" style={{ marginInlineStart: 8, fontSize: 10, fontWeight: 600, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "1px 7px" }}>{tr(lang, "notCounted")}</span>}
                </span>
                {!g.excluded && options.shareBars !== false && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{share}%</span>}
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90, textAlign: "end", opacity: g.excluded ? 0.6 : 1 }}>{fmtNum(g.total)}</span>
              </div>
              {!g.excluded && options.shareBars !== false && g.heads.length > 0 && (
                <div style={{ height: 3, borderRadius: 2, background: "rgba(0,0,0,0.06)", marginTop: 7, marginInlineStart: 23 }}>
                  <div style={{ height: 3, borderRadius: 2, background: color, width: `${share}%` }} />
                </div>
              )}
              <BudgetLine group={g} tone={tone} lang={lang} />
            </button>
            {!isClosed && g.heads.map((h) => {
              const clickable = onDrill && h.items?.length > 0;
              return (
                <div key={h.label} onClick={clickable ? () => onDrill({ head: h, group: g, tone }) : undefined}
                  role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter") onDrill({ head: h, group: g, tone }); } : undefined}
                  title={clickable ? "Click to see the records" : undefined}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 20px 9px 43px", borderTop: "1px solid #f1f5f9", fontSize: 14, cursor: clickable ? "pointer" : "default" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={clickable ? { textDecoration: "underline dotted #cbd5e1", textUnderlineOffset: 3 } : undefined}>{pick(lang, h.label, h.labelUr)}</div>
                    {options.branchSplit !== false && h.branches.length > 1 && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {h.branches.map((b) => `${b.name} ${fmtNum(b.amount)}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmtNum(h.amount)}</div>
                </div>
              );
            })}
          </div>
        );
      })}

      {(section.hiddenAmount > 0 || section.excludedAmount > 0) && (
        <div style={{ padding: "10px 20px", fontSize: 11, color: "var(--text-muted)", background: "#f8fafc" }}>
          {section.hiddenAmount > 0 && <div>Rs. {fmtNum(section.hiddenAmount)} hidden by your report layout</div>}
          {section.excludedAmount > 0 && <div>Rs. {fmtNum(section.excludedAmount)} shown but not counted in the total</div>}
        </div>
      )}
    </div>
  );
}

export default function MonthView({ statement, previous, outstanding, allBranches, onDrill, ledgerGap }) {
  const options = statement.options || {};
  const lang = options.language || "en";
  const single = isSingleMonth(statement.from, statement.to);
  const periodText = rangeLabel(statement.from, statement.to);
  const net = statement.net;
  const hasActivity = statement.totalIncome || statement.totalExpense;
  const budgeted = statement.expense.budgetTotal > 0;
  const showOutstanding = Boolean(options.outstanding !== false && outstanding && (outstanding.fees.total || outstanding.salaries.total));

  return (
    <div dir={lang === "ur" ? "rtl" : "ltr"}>
      <div style={{ background: "var(--sidebar-bg)", borderRadius: 14, padding: "20px 24px", marginBottom: 16, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 1 }}>{tr(lang, "closing")}</div>
          <div style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>{fmtMoney(statement.closingBalance)}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{single ? periodLabel(lang, statement.year, statement.month, periodText) : periodText}</div>
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{tr(lang, net >= 0 ? "surplus" : "deficit")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: net >= 0 ? "#6ee7b7" : "#fca5a5" }}>Rs. {fmtNum(Math.abs(net))}</div>
          {budgeted && (
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
              {tr(lang, "budget")}: {fmtNum(statement.expense.total)} / {fmtNum(statement.expense.budgetTotal)} ({Math.round((statement.expense.total / statement.expense.budgetTotal) * 100)}%)
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label={tr(lang, "opening")} value={statement.openingBalance} icon={Wallet} color="#4f46e5" bg="#eef2ff">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Cash &amp; bank at the start</span>
        </StatCard>
        <StatCard label={tr(lang, "totalIncome")} value={statement.totalIncome} icon={TrendingUp} color="#10b981" bg="#ecfdf5">
          {options.comparison !== false && <Delta current={statement.totalIncome} previous={previous.totalIncome} upIsGood lang={lang} single={single} />}
        </StatCard>
        <StatCard label={tr(lang, "totalExpense")} value={statement.totalExpense} icon={TrendingDown} color="#ef4444" bg="#fef2f2">
          {options.comparison !== false && <Delta current={statement.totalExpense} previous={previous.totalExpense} upIsGood={false} lang={lang} single={single} />}
        </StatCard>
        <StatCard label={tr(lang, "closing")} value={statement.closingBalance} icon={Scale} color="var(--primary)" bg="var(--primary-light)">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Opening + income − expense</span>
        </StatCard>
      </div>

      {!hasActivity && (
        <div style={{ ...card, padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
          Nothing recorded for {periodText}. Try another period or clear the filters, or turn on <strong>History</strong> in the top bar to include imported records.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
        <Section title={tr(lang, "income")} tone="income" section={statement.income} color="#10b981" tint="#f0fdf4" emptyText="No income recorded in this period" options={options} lang={lang} onDrill={onDrill} />
        <Section title={tr(lang, "expense")} tone="expense" section={statement.expense} color="#ef4444" tint="#fef2f2" emptyText="No expenses recorded in this period" options={options} lang={lang} onDrill={onDrill} />
      </div>

      {showOutstanding && (
        <div style={{ ...card, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
            <Receipt size={17} color="#f59e0b" />
            <div>
              <h3 style={{ fontWeight: 700, fontSize: 15 }}>{tr(lang, "outstanding")}</h3>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Still to be collected or paid — based on invoice and payslip status today, not part of the totals above</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div style={{ padding: "14px 20px", borderInlineEnd: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{tr(lang, "pendingFees")} · {outstanding.fees.count} invoices</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#f59e0b", margin: "3px 0" }}>Rs. {fmtNum(outstanding.fees.total)}</div>
              {outstanding.fees.byBranch.length > 1 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{outstanding.fees.byBranch.map((b) => `${b.name} ${fmtNum(b.amount)}`).join(" · ")}</div>
              )}
            </div>
            <div style={{ padding: "14px 20px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{tr(lang, "unpaidSalaries")} · {outstanding.salaries.count} payslips</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444", margin: "3px 0" }}>Rs. {fmtNum(outstanding.salaries.total)}</div>
            </div>
          </div>
        </div>
      )}

      {allBranches && options.accounts !== false && statement.cashAccounts.length > 0 && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ fontWeight: 700, fontSize: 15 }}>{tr(lang, "accounts")}</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Where the money sits, from your Chart of Accounts and payments</div>
          </div>
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  <th style={{ padding: "10px 20px", textAlign: "start", fontWeight: 600 }}>{tr(lang, "account")}</th>
                  {["colOpening", "colIn", "colOut", "colClosing"].map((h) => <th key={h} style={{ padding: "10px 20px", fontWeight: 600, textAlign: "end" }}>{tr(lang, h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {statement.cashAccounts.map((a) => (
                  <tr key={a.name} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 20px", fontWeight: 600 }}>{a.name}</td>
                    <td style={{ padding: "10px 20px", textAlign: "end" }}>{fmtNum(a.opening)}</td>
                    <td style={{ padding: "10px 20px", textAlign: "end", color: "#10b981" }}>{fmtNum(a.moneyIn)}</td>
                    <td style={{ padding: "10px 20px", textAlign: "end", color: "#ef4444" }}>{fmtNum(a.moneyOut)}</td>
                    <td style={{ padding: "10px 20px", textAlign: "end", fontWeight: 700 }}>{fmtNum(a.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledgerGap !== 0 && (
            <div style={{ padding: "12px 20px", background: "#fffbeb", borderTop: "1px solid var(--border)", fontSize: 12, color: "#92400e" }}>
              The statement's closing balance is Rs. {fmtNum(Math.abs(ledgerGap))} {ledgerGap > 0 ? "higher" : "lower"} than the accounts above because some
              income or expenses this month weren't posted to a Bank &amp; Cash account (e.g. an expense saved without "paid from"), or because of manual lines.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
