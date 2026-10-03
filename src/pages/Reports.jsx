import React, { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getAllDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line, CartesianGrid,
} from "recharts";
import {
  prepareData, allRecordDates, presetRange, customRange, previousRange, resolveRange, rangeLabel, isoDay,
  computeFinancials, buildSeries, branchBreakdown, computeCashFlow, computeBalanceSheet,
  filterFeeRows, summarizeFees, buildHighlights, change, formatRs, formatPct,
} from "../utils/reportData";
import ReportFilters, { Field, Select, controlStyle } from "../components/Reports/ReportFilters";
import { Card, Delta, KpiCard, KpiGrid, Highlights, BarList, DataTable, compact, moneyTip, cardStyle } from "../components/Reports/ReportParts";

const GREEN = "#10b981", RED = "#ef4444", AMBER = "#f59e0b", INDIGO = "#4f46e5", BRAND = "#7a2535", INK = "#1e293b";
const DEFAULT_PRESET = "thisYear";
const TABS = [
  { id: "pl", label: "Profit & Loss" },
  { id: "bs", label: "Balance Sheet" },
  { id: "cf", label: "Cash Flow" },
  { id: "fees", label: "Fee Collection" },
];
const STATUS_OPTIONS = [
  { value: "paid", label: "Paid" }, { value: "partial", label: "Partially paid" },
  { value: "pending", label: "Pending" }, { value: "overdue", label: "Overdue" },
];
const fmtDate = (d) => (d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

export default function Reports() {
  const { activeBranch, branches } = useBranch();
  const today = useMemo(() => new Date(), []);

  // ---- raw data (fetched once, filtered in memory) ----
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const names = ["invoices", "expenses", "payslips", "payments", "students", "accounts"];
      const snaps = await Promise.all(names.map(n => getAllDocs(collection(db, n))));
      const next = {};
      names.forEach((n, i) => { next[n] = snaps[i].docs.map(d => ({ id: d.id, ...d.data() })); });
      setRaw(next);
    } catch (e) {
      console.error("Reports load error:", e);
      setError(e?.message || "Could not load report data");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- filters ----
  const [activeTab, setActiveTab] = useState("pl");
  const [branch, setBranch] = useState(activeBranch);
  useEffect(() => { setBranch(activeBranch); }, [activeBranch]); // follow the header switcher
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [granularity, setGranularity] = useState("auto");
  const [compare, setCompare] = useState(true);
  const [account, setAccount] = useState("");       // cash flow
  const [grade, setGrade] = useState("");           // fees
  const [status, setStatus] = useState("");
  const [feeAccount, setFeeAccount] = useState("");
  const [search, setSearch] = useState("");

  const dirty = branch !== activeBranch || preset !== DEFAULT_PRESET || granularity !== "auto" || !compare
    || account || grade || status || feeAccount || search;
  const reset = () => {
    setBranch(activeBranch); setPreset(DEFAULT_PRESET); setCustom({ from: "", to: "" }); setGranularity("auto");
    setCompare(true); setAccount(""); setGrade(""); setStatus(""); setFeeAccount(""); setSearch("");
  };

  const branchOptions = useMemo(() => [
    { value: "all", label: "All branches" }, { value: "main", label: "Main Office" },
    ...branches.map(b => ({ value: b.id, label: b.name })),
  ], [branches]);
  const branchName = (id) => branchOptions.find(o => o.value === id)?.label || "Main Office";
  const branchLabelOf = (rec) => (rec.branchId ? branches.find(b => b.id === rec.branchId)?.name || "Branch" : "Main Office");

  // ---- derived data ----
  const data = useMemo(() => prepareData(raw || {}), [raw]);
  const range = useMemo(
    () => (preset === "custom" ? customRange(custom.from, custom.to) : presetRange(preset, today)),
    [preset, custom, today]
  );
  const prevRange = useMemo(() => (compare ? previousRange(range) : null), [compare, range]);
  const resolved = useMemo(() => resolveRange(range, allRecordDates(data), today), [range, data, today]);

  const fin = useMemo(() => computeFinancials(data, { range, branch }), [data, range, branch]);
  const prevFin = useMemo(() => (prevRange ? computeFinancials(data, { range: prevRange, branch }) : null), [data, prevRange, branch]);
  const series = useMemo(() => buildSeries(data, { range: resolved, branch, granularity }), [data, resolved, branch, granularity]);
  const branchRows = useMemo(() => (branch === "all" ? branchBreakdown(data, branches, { range }) : null), [data, branches, range, branch]);

  const feeRows = useMemo(
    () => filterFeeRows(data.invoices, { branch, grade, status, account: feeAccount, search, today }),
    [data.invoices, branch, grade, status, feeAccount, search, today]
  );
  const fees = useMemo(() => summarizeFees(feeRows, { range, granularity, today }), [feeRows, range, granularity, today]);
  const prevFees = useMemo(() => (prevRange ? summarizeFees(feeRows, { range: prevRange, today }) : null), [feeRows, prevRange, today]);

  const cash = useMemo(() => computeCashFlow(data, { range: resolved, branch, account, granularity }), [data, resolved, branch, account, granularity]);
  const sheet = useMemo(() => computeBalanceSheet(data, { asAt: range.to, branch }), [data, range, branch]);

  const gradeOptions = useMemo(() => [...new Set(data.invoices.map(i => i._grade))].sort().map(g => ({ value: g, label: g })), [data.invoices]);
  const feeAccountOptions = useMemo(() => [...new Set(data.invoices.map(i => i.paidAccount).filter(Boolean))].sort().map(a => ({ value: a, label: a })), [data.invoices]);

  const periodText = activeTab === "bs"
    ? `As at ${range.to ? fmtDate(range.to) : "today"}`
    : rangeLabel(range);
  const summary = `${branchName(branch)} · ${periodText}${prevRange && activeTab !== "bs" && activeTab !== "cf" ? ` · vs ${rangeLabel(prevRange)}` : ""}`;

  // ---- exports (each tab exports its main table) ----
  const exportSpec = () => {
    const title = `${TABS.find(t => t.id === activeTab).label} — ${branchName(branch)} — ${periodText}`;
    if (activeTab === "pl") {
      const lines = plLines(fin, prevFin, true);
      const headers = ["Line", "Amount (Rs.)", ...(prevFin ? ["Previous period (Rs.)"] : [])];
      const rows = lines.map(l => [l.label, l.kind === "section" ? "" : Math.round(l.value), ...(prevFin ? [l.kind === "section" ? "" : Math.round(l.prev || 0)] : [])]);
      return { title, headers, rows };
    }
    if (activeTab === "bs") {
      const rows = [
        ...sheet.assets.rows.map(r => ["Assets", r.code, r.name, Math.round(r.balance)]),
        ["Assets", "", "Total assets", Math.round(sheet.assets.total)],
        ...sheet.liabilitiesEquity.rows.map(r => ["Liabilities & Equity", r.code, r.name, Math.round(r.balance)]),
        ["Liabilities & Equity", "", "Total liabilities & equity", Math.round(sheet.liabilitiesEquity.total)],
      ];
      return { title, headers: ["Section", "Code", "Account", "Balance (Rs.)"], rows };
    }
    if (activeTab === "cf") {
      return {
        title,
        headers: ["Date", "Account", "Type", "Category", "Description", "Branch", "Amount (Rs.)"],
        rows: cash.transactions.map(p => [isoDay(p._on), p.account, p.type === "cash_in" ? "Cash in" : "Cash out", p.category || "", p.description || "", branchLabelOf(p), Math.round(p._amount)]),
      };
    }
    const inBilled = fees.cohort;
    return {
      title,
      headers: ["Student", "Student ID", "Grade", "Branch", "Month", "Year", "Billed (Rs.)", "Paid (Rs.)", "Concession (Rs.)", "Outstanding (Rs.)", "Status", "Due date", "Paid date", "Paid into"],
      rows: inBilled.map(i => [i._student, i._studentCode, i._grade, branchLabelOf(i), i.month || "", i.year || "", Math.round(i._amount), Math.round(i._paid), Math.round(i._concession), Math.round(i._outstanding), i.status, i.dueDate || "", i._collectedOn ? isoDay(i._collectedOn) : "", i.paidAccount || ""]),
    };
  };
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const handleCSV = () => { const s = exportSpec(); exportToCSV(`report-${activeTab}-${slug(branchName(branch))}-${isoDay(today)}`, s.headers, s.rows); };
  const handlePDF = () => { const s = exportSpec(); exportToPDF(s.title, s.headers, s.rows.map(r => r.map(c => (typeof c === "number" ? c.toLocaleString() : c)))); };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Reports</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>Financial statements and analytics</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 14, fontWeight: 500, background: activeTab === t.id ? "var(--primary)" : "white", color: activeTab === t.id ? "white" : "#475569" }}>
            {t.label}
          </button>
        ))}
      </div>

      <ReportFilters
        branchOptions={branchOptions} branch={branch} onBranch={setBranch}
        preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom}
        periodLabel={activeTab === "bs" ? "As at (end of period)" : "Period"}
        granularity={activeTab === "bs" ? undefined : granularity} onGranularity={setGranularity}
        showCompare={activeTab === "pl" || activeTab === "fees"} compare={compare} onCompare={setCompare}
        dirty={Boolean(dirty)} onReset={reset} summary={summary}
        onRefresh={load} refreshing={loading} onCSV={raw ? handleCSV : undefined} onPDF={raw ? handlePDF : undefined}
      >
        {activeTab === "cf" && <Select label="Account" value={account} onChange={setAccount} allLabel="All accounts" options={cash.accountNames.map(n => ({ value: n, label: n }))} />}
        {activeTab === "fees" && (
          <>
            <Select label="Class / grade" value={grade} onChange={setGrade} allLabel="All grades" options={gradeOptions} />
            <Select label="Status" value={status} onChange={setStatus} allLabel="All statuses" options={STATUS_OPTIONS} />
            <Select label="Paid into" value={feeAccount} onChange={setFeeAccount} allLabel="All accounts" options={feeAccountOptions} />
            <Field label="Student">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or ID…" style={{ ...controlStyle, width: 150 }} />
            </Field>
          </>
        )}
      </ReportFilters>

      {error && (
        <div style={{ ...cardStyle, padding: 16, marginBottom: 24, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14 }}>
          Could not load report data: {error}{" "}
          <button onClick={load} style={{ marginLeft: 8, cursor: "pointer", border: "1px solid #fecaca", background: "white", borderRadius: 6, padding: "4px 10px" }}>Retry</button>
        </div>
      )}
      {!raw && !error && <div style={{ ...cardStyle, padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading reports…</div>}

      {raw && activeTab === "pl" && (
        <ProfitLoss fin={fin} prevFin={prevFin} series={series} branchRows={branchRows} range={range}
          highlights={buildHighlights({ cur: fin, prev: prevFin, fees: null, branches: branchRows })} />
      )}
      {raw && activeTab === "bs" && <BalanceSheet sheet={sheet} />}
      {raw && activeTab === "cf" && <CashFlow cash={cash} branchLabelOf={branchLabelOf} />}
      {raw && activeTab === "fees" && (
        <FeeCollection fees={fees} prevFees={prevFees}
          highlights={buildHighlights({ cur: fin, prev: null, fees, branches: null, only: "fees" })} />
      )}
    </div>
  );
}

// =============================================================== Profit & Loss

// One list drives both the on-screen statement and its CSV/PDF export.
function plLines(cur, prev, detail) {
  const prevOf = (list, label) => (prev ? (prev[list].find(r => r.label === label)?.amount ?? 0) : null);
  const L = [];
  const line = (label, value, prevValue, o = {}) => L.push({ kind: "line", label, value, prev: prevValue, ...o });
  const subs = (list, indent = "   ") => detail && cur[list].forEach(r => L.push({ kind: "sub", label: `${indent}${r.label}`, value: r.amount, prev: prevOf(list, r.label), goodWhen: list === "byHead" ? "up" : "down" }));

  L.push({ kind: "section", label: "Income" });
  line("Total billed (face value)", cur.billed, prev?.billed, { muted: true });
  line("Fee collections (received)", cur.collected, prev?.collected, { color: GREEN });
  subs("byHead");
  line("Concessions (waived)", cur.concessions, prev?.concessions, { color: AMBER, goodWhen: "down" });
  line("Pending fees (outstanding)", cur.pending, prev?.pending, { muted: true, goodWhen: "down" });
  L.push({ kind: "total", label: "Total income", value: cur.income, prev: prev?.income, color: GREEN });

  L.push({ kind: "section", label: "Expenses" });
  line("Operating expenses", cur.opex, prev?.opex, { color: RED, goodWhen: "down" });
  subs("byCategory");
  line("Salaries & payroll", cur.payroll, prev?.payroll, { color: RED, goodWhen: "down" });
  subs("byRole");
  if (cur.payrollUnpaid > 0) L.push({ kind: "sub", label: "   of which not yet paid", value: cur.payrollUnpaid, prev: prev?.payrollUnpaid, goodWhen: "down" });
  L.push({ kind: "total", label: "Total expenses", value: cur.totalExpenses, prev: prev?.totalExpenses, color: RED, goodWhen: "down" });
  return L;
}

function ProfitLoss({ fin, prevFin, series, branchRows, range, highlights }) {
  const [detail, setDetail] = useState(true);
  const lines = plLines(fin, prevFin, detail);
  const surplus = fin.net >= 0;
  const cols = prevFin ? 4 : 2;
  const num = { textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div>
      <KpiGrid>
        <KpiCard label="Income (collected)" value={formatRs(fin.income)} color={GREEN} bg="#ecfdf5" delta={prevFin && change(fin.income, prevFin.income)} />
        <KpiCard label="Total expenses" value={formatRs(fin.totalExpenses)} color={RED} bg="#fef2f2" goodWhen="down" delta={prevFin && change(fin.totalExpenses, prevFin.totalExpenses)} />
        <KpiCard label={surplus ? "Net surplus" : "Net deficit"} value={formatRs(Math.abs(fin.net))} color={surplus ? GREEN : RED} bg={surplus ? "#ecfdf5" : "#fef2f2"} delta={prevFin && change(fin.net, prevFin.net)} />
        <KpiCard label="Margin" value={formatPct(fin.margin)} sub="of fee income" color={INDIGO} bg="#eef2ff" />
      </KpiGrid>

      <Highlights items={highlights} />

      <Card title="Profit & Loss Statement" subtitle={`${rangeLabel(range)} · income is cash received, expenses by date / payslip period`} style={{ marginBottom: 24 }} pad={0}
        right={<label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={detail} onChange={e => setDetail(e.target.checked)} /> Show breakdown</label>}>
        <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            {prevFin && (
              <thead><tr style={{ color: "var(--text-muted)", fontSize: 12 }}>
                <th style={{ textAlign: "left", padding: "10px 24px", fontWeight: 600 }} />
                <th style={{ ...num, padding: "10px 12px", fontWeight: 600 }}>This period</th>
                <th style={{ ...num, padding: "10px 12px", fontWeight: 600 }}>Previous</th>
                <th style={{ ...num, padding: "10px 24px 10px 12px", fontWeight: 600 }}>Change</th>
              </tr></thead>
            )}
            <tbody>
              {lines.map((l, i) => {
                if (l.kind === "section")
                  return <tr key={i}><td colSpan={cols} style={{ padding: "20px 24px 6px", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>{l.label}</td></tr>;
                const sub = l.kind === "sub", total = l.kind === "total";
                const vPad = sub ? 5 : 10;
                const base = { paddingTop: vPad, paddingBottom: vPad, paddingLeft: 12, paddingRight: 12, borderBottom: total ? "none" : "1px solid var(--border)", borderTop: total ? "2px solid var(--border)" : "none", opacity: l.muted ? 0.55 : 1, fontWeight: total ? 700 : 400, fontSize: sub ? 13 : 14, color: sub ? "#475569" : undefined };
                return (
                  <tr key={i}>
                    <td style={{ ...base, paddingLeft: 24, whiteSpace: "pre" }}>{l.label}</td>
                    <td style={{ ...base, ...num, fontWeight: sub ? 500 : 600, color: sub ? "#475569" : l.color || INK, paddingRight: prevFin ? 12 : 24 }}>{formatRs(l.value)}</td>
                    {prevFin && <td style={{ ...base, ...num, color: "var(--text-muted)" }}>{formatRs(l.prev || 0)}</td>}
                    {prevFin && <td style={{ ...base, ...num, paddingRight: 24 }}><Delta delta={change(l.value, l.prev || 0)} goodWhen={l.goodWhen} compact /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", margin: 24, padding: "16px 20px", background: surplus ? "#ecfdf5" : "#fef2f2", borderRadius: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Net {surplus ? "Surplus" : "Deficit"}</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: surplus ? GREEN : RED }}>{formatRs(Math.abs(fin.net))}</span>
        </div>
      </Card>

      <Card title={`Income vs expenses by ${series.granularity}`} style={{ marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={series.buckets}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={compact} width={48} />
            <Tooltip formatter={moneyTip} />
            <Legend />
            <Bar dataKey="income" name="Income" fill={GREEN} radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name="Operating expenses" fill={RED} radius={[4, 4, 0, 0]} />
            <Bar dataKey="payroll" name="Payroll" fill={INDIGO} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="net" name="Net" stroke={INK} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-1-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 24, marginBottom: 24 }}>
        <Card title="Income by fee type" subtitle="Collected, split by invoice line item"><BarList rows={fin.byHead} color={GREEN} empty="No fees collected in this period." /></Card>
        <Card title="Operating expenses by category"><BarList rows={fin.byCategory} color={RED} empty="No expenses in this period." /></Card>
        <Card title="Payroll by role"><BarList rows={fin.byRole} color={INDIGO} empty="No payslips in this period." /></Card>
      </div>

      {branchRows && (
        <Card title="Branch comparison" subtitle="Same period, every branch" pad={0}>
          <DataTable
            rows={branchRows} rowKey={r => r.id}
            columns={[
              { key: "name", label: "Branch" },
              { key: "students", label: "Students", align: "right" },
              { key: "billed", label: "Billed", align: "right", render: r => formatRs(r.billed) },
              { key: "income", label: "Collected", align: "right", render: r => formatRs(r.income) },
              { key: "rate", label: "Collection rate", align: "right", render: r => formatPct(r.collectionRate) },
              { key: "expenses", label: "Expenses", align: "right", render: r => formatRs(r.expenses) },
              { key: "payroll", label: "Payroll", align: "right", render: r => formatRs(r.payroll) },
              { key: "net", label: "Net", align: "right", render: r => <strong style={{ color: r.net >= 0 ? GREEN : RED }}>{formatRs(r.net)}</strong> },
            ]}
            footer={["Total", branchRows.reduce((s, r) => s + r.students, 0), formatRs(sum(branchRows, "billed")), formatRs(sum(branchRows, "income")), "", formatRs(sum(branchRows, "expenses")), formatRs(sum(branchRows, "payroll")), formatRs(sum(branchRows, "net"))]}
          />
        </Card>
      )}
    </div>
  );
}

const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

// ================================================================ Balance sheet

function BalanceSheet({ sheet }) {
  return (
    <Card title="Balance Sheet" pad={0}
      subtitle="Asset accounts: opening balance + posted payments up to the date. Liabilities & equity: balance stored in the Chart of Accounts.">
      {sheet.branchScoped && (
        <div style={{ padding: "10px 24px", background: "#fffbeb", color: "#92400e", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
          Showing only payments posted to the selected branch. Account opening balances and liabilities & equity belong to the whole organisation, so opening balances are left out here.
        </div>
      )}
      <div className="grid-1-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {[
          { title: "Assets", side: sheet.assets, color: GREEN },
          { title: "Liabilities & Equity", side: sheet.liabilitiesEquity, color: INDIGO },
        ].map(({ title, side, color }, i) => (
          <div key={title} style={{ padding: 24, borderRight: i === 0 ? "1px solid var(--border)" : "none" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 16 }}>{title}</div>
            {side.rows.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No accounts added yet. Add accounts in Chart of Accounts.</div>}
            {side.rows.map(acc => (
              <div key={acc.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                <span style={{ color: "var(--text-muted)" }}>{acc.code} — {acc.name}</span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatRs(acc.balance)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 700, fontSize: 15 }}>
              <span>Total {title}</span><span style={{ color }}>{formatRs(side.total)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ================================================================== Cash flow

function CashFlow({ cash, branchLabelOf }) {
  const recent = cash.transactions.slice(-100).reverse();
  return (
    <div>
      {cash.openingExcluded && (
        <div style={{ ...cardStyle, padding: "10px 16px", marginBottom: 16, background: "#fffbeb", borderColor: "#fde68a", color: "#92400e", fontSize: 13 }}>
          Account opening balances are organisation-wide, so with a single branch selected the opening balance only reflects payments posted earlier to that branch.
        </div>
      )}
      <KpiGrid columns={5}>
        <KpiCard label="Opening balance" value={formatRs(cash.opening)} />
        <KpiCard label="Cash in" value={formatRs(cash.inflow)} color={GREEN} bg="#ecfdf5" />
        <KpiCard label="Cash out" value={formatRs(cash.outflow)} color={RED} bg="#fef2f2" />
        <KpiCard label="Net cash flow" value={formatRs(cash.net)} color={cash.net >= 0 ? INDIGO : RED} bg="#eef2ff" />
        <KpiCard label="Closing balance" value={formatRs(cash.closing)} color={BRAND} bg="var(--primary-light)" />
      </KpiGrid>

      <Card title={`Cash in vs out by ${cash.granularity}`} subtitle="From the payments ledger (reversed entries excluded) — line shows the running balance" style={{ marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={cash.buckets}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={compact} width={48} />
            <Tooltip formatter={moneyTip} />
            <Legend />
            <Bar dataKey="inflow" name="Cash in" fill={GREEN} radius={[4, 4, 0, 0]} />
            <Bar dataKey="outflow" name="Cash out" fill={RED} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="balance" name="Balance" stroke={BRAND} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-1-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <Card title="Cash in by category"><BarList rows={cash.inByCategory} color={GREEN} empty="No cash received in this period." /></Card>
        <Card title="Cash out by category"><BarList rows={cash.outByCategory} color={RED} empty="No cash paid out in this period." /></Card>
      </div>

      <Card title="By account" pad={0} style={{ marginBottom: 24 }}>
        <DataTable
          rows={cash.perAccount} rowKey={r => r.name} empty="No bank or cash accounts yet."
          columns={[
            { key: "name", label: "Account" },
            { key: "opening", label: "Opening", align: "right", render: r => formatRs(r.opening) },
            { key: "inflow", label: "In", align: "right", render: r => <span style={{ color: GREEN }}>{formatRs(r.inflow)}</span> },
            { key: "outflow", label: "Out", align: "right", render: r => <span style={{ color: RED }}>{formatRs(r.outflow)}</span> },
            { key: "closing", label: "Closing", align: "right", render: r => <strong>{formatRs(r.closing)}</strong> },
          ]}
          footer={["Total", formatRs(cash.opening), formatRs(cash.inflow), formatRs(cash.outflow), formatRs(cash.closing)]}
        />
      </Card>

      <Card title="Transactions" subtitle={`${cash.transactions.length.toLocaleString()} in this period${cash.transactions.length > recent.length ? ` — latest ${recent.length} shown, export for all` : ""}`} pad={0}>
        <DataTable
          rows={recent} rowKey={r => r.id} empty="No transactions in this period."
          columns={[
            { key: "date", label: "Date", render: r => fmtDate(r._on) },
            { key: "account", label: "Account" },
            { key: "category", label: "Category", render: r => r.category || "—" },
            { key: "description", label: "Description", nowrap: false, render: r => r.description || "—" },
            { key: "branch", label: "Branch", render: r => branchLabelOf(r) },
            { key: "in", label: "In", align: "right", render: r => (r.type === "cash_in" ? <span style={{ color: GREEN }}>{formatRs(r._amount)}</span> : "") },
            { key: "out", label: "Out", align: "right", render: r => (r.type === "cash_out" ? <span style={{ color: RED }}>{formatRs(r._amount)}</span> : "") },
          ]}
        />
      </Card>
    </div>
  );
}

// ============================================================== Fee collection

const STATUS_STYLE = {
  paid: { bg: "#ecfdf5", fg: "#059669", label: "Paid" },
  partial: { bg: "#eff6ff", fg: "#2563eb", label: "Partial" },
  pending: { bg: "#fffbeb", fg: "#d97706", label: "Pending" },
  overdue: { bg: "#fef2f2", fg: "#dc2626", label: "Overdue" },
};

function FeeCollection({ fees, prevFees, highlights }) {
  const [showAll, setShowAll] = useState(false);
  const defaulters = showAll ? fees.defaulters : fees.defaulters.slice(0, 10);
  const total = Object.values(fees.statusCounts).reduce((a, b) => a + b, 0);
  const statusRows = Object.entries(fees.statusCounts).map(([k, n]) => ({ label: STATUS_STYLE[k].label, amount: n, share: total ? n / total : 0, key: k }));

  return (
    <div>
      <KpiGrid columns={5}>
        <KpiCard label="Billed" value={formatRs(fees.billed)} sub={`${fees.cohort.length.toLocaleString()} invoices`} delta={prevFees && change(fees.billed, prevFees.billed)} />
        <KpiCard label="Collected" value={formatRs(fees.collected)} color={GREEN} bg="#ecfdf5" sub="against these invoices" delta={prevFees && change(fees.collected, prevFees.collected)} />
        <KpiCard label="Outstanding" value={formatRs(fees.outstanding)} color={AMBER} bg="#fffbeb" goodWhen="down" sub={fees.overdue > 0 ? `${formatRs(fees.overdue)} overdue` : "none overdue"} delta={prevFees && change(fees.outstanding, prevFees.outstanding)} />
        <KpiCard label="Collection rate" value={formatPct(fees.rate)} color={INDIGO} bg="#eef2ff" sub="after concessions" delta={prevFees && fees.rate !== null && prevFees.rate !== null ? { amount: (fees.rate - prevFees.rate) * 100, pct: null, unit: "pts" } : null} />
        <KpiCard label="Cash received in period" value={formatRs(fees.receivedInPeriod)} color={BRAND} bg="var(--primary-light)" sub="by payment date" />
      </KpiGrid>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "-12px 0 24px" }}>
        Billed, collected, outstanding and collection rate describe the invoices billed in the selected period (by invoice month). “Cash received” counts payments made in the period, whichever month they were billed for.
      </p>

      <Highlights items={highlights} />

      <Card title={`Billed vs received by ${fees.granularity}`} style={{ marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={fees.buckets}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={compact} width={48} />
            <Tooltip formatter={moneyTip} />
            <Legend />
            <Bar dataKey="billed" name="Billed" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="received" name="Received" fill={BRAND} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-1-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 24, marginBottom: 24 }}>
        <Card title="Invoice status" subtitle="Overdue = unpaid past its due date">
          {total === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No invoices for this selection.</div> : statusRows.map(r => (
            <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: STATUS_STYLE[r.key].bg, color: STATUS_STYLE[r.key].fg }}>{r.label}</span>
              <span style={{ fontWeight: 600 }}>{r.amount.toLocaleString()} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {Math.round(r.share * 100)}%</span></span>
            </div>
          ))}
        </Card>
        <Card title="Outstanding by age" subtitle="Days past due date">
          <BarList rows={fees.aging.map(a => ({ label: a.label, amount: a.amount, share: fees.outstanding ? a.amount / fees.outstanding : 0 }))} color={AMBER} limit={10} />
        </Card>
        <Card title="Received by account"><BarList rows={fees.byAccount} color={BRAND} empty="No payments in this period." /></Card>
      </div>

      <Card title="By class / grade" pad={0} style={{ marginBottom: 24 }}>
        <DataTable
          rows={fees.byGrade} rowKey={r => r.grade} empty="No invoices for this selection."
          columns={[
            { key: "grade", label: "Grade" },
            { key: "students", label: "Students", align: "right" },
            { key: "billed", label: "Billed", align: "right", render: r => formatRs(r.billed) },
            { key: "collected", label: "Collected", align: "right", render: r => <span style={{ color: GREEN }}>{formatRs(r.collected)}</span> },
            { key: "concessions", label: "Concessions", align: "right", render: r => formatRs(r.concessions) },
            { key: "outstanding", label: "Outstanding", align: "right", render: r => <strong style={{ color: r.outstanding > 0 ? AMBER : "#64748b" }}>{formatRs(r.outstanding)}</strong> },
            { key: "rate", label: "Rate", align: "right", render: r => formatPct(r.rate) },
          ]}
        />
      </Card>

      <Card title="By fee type" subtitle="Invoice line items — collected is spread across items in proportion" pad={0} style={{ marginBottom: 24 }}>
        <DataTable
          rows={fees.byHead} rowKey={r => r.head} empty="No invoices for this selection."
          columns={[
            { key: "head", label: "Fee type" },
            { key: "billed", label: "Billed", align: "right", render: r => formatRs(r.billed) },
            { key: "collected", label: "Collected", align: "right", render: r => <span style={{ color: GREEN }}>{formatRs(r.collected)}</span> },
            { key: "outstanding", label: "Outstanding", align: "right", render: r => formatRs(r.outstanding) },
          ]}
        />
      </Card>

      <Card title="Students with outstanding fees" subtitle={`${fees.defaulters.length.toLocaleString()} student${fees.defaulters.length === 1 ? "" : "s"} · largest balance first`} pad={0}
        right={fees.defaulters.length > 10 && <button onClick={() => setShowAll(s => !s)} style={{ ...controlStyle, cursor: "pointer" }}>{showAll ? "Show top 10" : `Show all ${fees.defaulters.length}`}</button>}>
        <DataTable
          rows={defaulters} rowKey={r => r.key} empty="No outstanding fees — nice."
          columns={[
            { key: "student", label: "Student", render: r => <span>{r.student}{r.code && <span style={{ color: "var(--text-muted)" }}> · {r.code}</span>}</span> },
            { key: "grade", label: "Grade" },
            { key: "phone", label: "Parent phone", render: r => r.phone || "—" },
            { key: "invoices", label: "Unpaid invoices", align: "right" },
            { key: "oldest", label: "Oldest due", render: r => fmtDate(r.oldestDue) || "—" },
            { key: "outstanding", label: "Outstanding", align: "right", render: r => <strong style={{ color: AMBER }}>{formatRs(r.outstanding)}</strong> },
          ]}
        />
      </Card>
    </div>
  );
}
