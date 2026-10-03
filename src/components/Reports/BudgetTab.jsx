// src/components/Reports/BudgetTab.jsx
// Budget vs actual for the selected branch and period. Budgets are monthly
// amounts (see utils/budgetData.js) kept in the `budgets` table.

import React, { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Pencil } from "lucide-react";
import { db, collection, doc, addDoc, updateDoc, deleteDoc } from "../../firebase";
import { matchesBranch } from "../../utils/branchFilter";
import { editorRows, diffBudgets, statusText } from "../../utils/budgetData";
import { formatRs, formatPct } from "../../utils/reportData";
import { Card, KpiCard, KpiGrid, DataTable } from "./ReportParts";
import { controlStyle } from "./ReportFilters";

const GOOD = "#10b981", WARN = "#f59e0b", BAD = "#ef4444";
const COLOR = { ok: GOOD, met: GOOD, near: WARN, over: BAD, behind: BAD, unbudgeted: BAD, none: "#cbd5e1" };

export default function BudgetTab({ budgets, budgetError, result, branch, categories, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const scoped = useMemo(() => (branch === "all" ? [] : budgets.filter(b => matchesBranch(b, branch))), [budgets, branch]);
  const editBranchId = branch === "main" ? "" : branch;
  const editable = canEdit && branch !== "all" && !budgetError;

  const startEdit = () => { setRows(editorRows(scoped, categories)); setNewCategory(""); setEditing(true); };
  const setAmount = (i, v) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, amount: v } : r)));
  const addCategory = () => {
    const c = newCategory.trim();
    if (!c) return;
    if (rows.some(r => r.kind === "expense" && r.category.toLowerCase() === c.toLowerCase())) return toast.error("That category is already listed");
    setRows(rs => [...rs.slice(0, -1), { kind: "expense", category: c, id: "", amount: "" }, rs[rs.length - 1]]);
    setNewCategory("");
  };

  const save = async () => {
    const { creates, updates, deletes } = diffBudgets(scoped, rows);
    if (!creates.length && !updates.length && !deletes.length) { setEditing(false); return; }
    setSaving(true);
    try {
      await Promise.all([
        ...creates.map(c => addDoc(collection(db, "budgets"), { ...c, branchId: editBranchId })),
        ...updates.map(u => updateDoc(doc(db, "budgets", u.id), { amount: u.amount })),
        ...deletes.map(id => deleteDoc(doc(db, "budgets", id))),
      ]);
      toast.success("Budget saved");
      setEditing(false);
      await onSaved();
    } catch (e) {
      toast.error(e?.message || "Could not save the budget");
    } finally {
      setSaving(false);
    }
  };

  if (budgetError) {
    return (
      <Card title="Budget vs Actual">
        <p style={{ fontSize: 14, color: "#92400e" }}>
          Budgets aren't set up yet. Run <code>supabase/budgets.sql</code> once in the Supabase SQL Editor, then press Refresh.
        </p>
      </Card>
    );
  }

  const pad = (n) => (n === null || n === undefined ? "—" : formatPct(n));
  const th = { textAlign: "left", fontSize: 12, color: "var(--text-muted)", fontWeight: 600, padding: "8px 12px" };

  return (
    <div>
      <KpiGrid>
        <KpiCard label="Spending budget" value={formatRs(result.expenseBudget)} sub={`${result.months.toFixed(1)} months`} />
        <KpiCard label="Actual spending" value={formatRs(result.expenseActual)} color={BAD} bg="#fef2f2" />
        <KpiCard label="Budget used" value={pad(result.expensePct)} color={result.expensePct > 1 ? BAD : "#4f46e5"} bg="#eef2ff" sub="operating + payroll" />
        <KpiCard label="Net vs budget" value={formatRs(result.netActual - result.netBudget)} color={result.netActual >= result.netBudget ? GOOD : BAD} bg={result.netActual >= result.netBudget ? "#ecfdf5" : "#fef2f2"} sub={`budgeted net ${formatRs(result.netBudget)}`} />
      </KpiGrid>

      <Card title="Budget vs actual" pad={0} subtitle={`Monthly budgets scaled to the period, up to today (${result.proRatedTo.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}). Income actual = fees collected.`}
        right={editable && !editing && <button onClick={startEdit} style={{ ...controlStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Pencil size={13} /> Edit budget</button>}>
        {branch === "all" && <div style={{ padding: "10px 24px", background: "#fffbeb", color: "#92400e", fontSize: 13, borderBottom: "1px solid var(--border)" }}>Showing every branch's budgets added together. Pick a branch to edit its budget.</div>}
        {!result.hasBudget && <div style={{ padding: "14px 24px", fontSize: 14, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>No budget set for this selection yet.{editable ? " Use “Edit budget” to add monthly amounts." : ""}</div>}
        <DataTable
          rows={result.lines} rowKey={l => l.key}
          columns={[
            { key: "label", label: "Line", render: l => <span>{l.label}{l.kind === "income" && <span style={{ color: "var(--text-muted)", fontSize: 12 }}> (target)</span>}</span> },
            { key: "monthly", label: "Per month", align: "right", render: l => (l.monthly ? formatRs(l.monthly) : "—") },
            { key: "budget", label: "Budget for period", align: "right", render: l => (l.budget ? formatRs(l.budget) : "—") },
            { key: "actual", label: "Actual", align: "right", render: l => <strong>{formatRs(l.actual)}</strong> },
            {
              key: "bar", label: "Progress", nowrap: false, render: l => {
                const ratio = l.pct === null ? 0 : Math.min(l.pct, 1.5) / 1.5;
                return (
                  <div style={{ minWidth: 150 }}>
                    <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, position: "relative" }}>
                      <div style={{ height: 8, width: `${ratio * 100}%`, background: COLOR[l.status], borderRadius: 4 }} />
                      <div title="100% of budget" style={{ position: "absolute", left: `${(1 / 1.5) * 100}%`, top: -2, height: 12, width: 1, background: "#94a3b8" }} />
                    </div>
                    <div style={{ fontSize: 11, color: COLOR[l.status] === "#cbd5e1" ? "var(--text-muted)" : COLOR[l.status], marginTop: 3, fontWeight: 600 }}>
                      {l.pct !== null ? `${Math.round(l.pct * 100)}% · ` : ""}{statusText(l)}
                    </div>
                  </div>
                );
              },
            },
          ]}
          footer={["Total spending", "", formatRs(result.expenseBudget), formatRs(result.expenseActual), `${pad(result.expensePct)} used`]}
        />
      </Card>

      {editing && (
        <Card title={`Edit monthly budget — ${branch === "main" ? "Main Office" : "this branch"}`} subtitle="Amounts are per month. Leave a line blank (or 0) for no budget." style={{ marginTop: 24 }}>
          {rows.map((r, i) => (
            <div key={`${r.kind}:${r.category}`} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ width: 240, fontSize: 14 }}>
                {r.category}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}> {r.kind === "income" ? "· monthly target" : r.kind === "payroll" ? "· payroll" : ""}</span>
              </div>
              <input type="number" min="0" value={r.amount} placeholder="0" onChange={e => setAmount(i, e.target.value)} style={{ ...controlStyle, width: 160 }} aria-label={`${r.category} monthly budget`} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
            <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Add an expense category…" style={{ ...controlStyle, width: 240 }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }} />
            <button onClick={addCategory} style={{ ...controlStyle, cursor: "pointer" }}>Add</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "white", cursor: "pointer", fontWeight: 600 }}>{saving ? "Saving…" : "Save budget"}</button>
            <button onClick={() => setEditing(false)} style={{ ...controlStyle, cursor: "pointer" }}>Cancel</button>
          </div>
        </Card>
      )}
    </div>
  );
}
