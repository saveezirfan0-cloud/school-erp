import React, { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { db } from "../firebase";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { matchesBranch } from "../utils/branchFilter";
import { useBranch } from "../context/BranchContext";
import Pagination from "../components/UI/Pagination";
import { useBulkSelect } from "../hooks/useBulkSelect";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { runBulk, bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { createExpenseAndPost, reverseSourcePayments, rememberAccountChoice } from "../utils/accounting";
import { parsePositiveAmount, sumMoney, todayLocal, isIsoDate, formatMoney } from "../utils/money";
import { useAccounts } from "../utils/useAccounts";
import { useSubmitLock } from "../utils/useSubmitLock";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import { EXTRA_EXPENSE_CATEGORIES } from "../config/statementHeads";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Download, FileText, Pencil } from "lucide-react";

const CATEGORIES = ["Rent", "Utilities", "Salaries", "Supplies", "Maintenance", "Transport", "Other", ...EXTRA_EXPENSE_CATEGORIES];
const emptyLine = { description: "", amount: "", category: "" };
const emptyForm = () => ({ description: "", amount: "", category: "", date: todayLocal(), branchId: "", notes: "", paidAccountId: "" });

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Expenses() {
  const { can } = useUser();
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [expenses, setExpenses] = useState([]);
  const { accounts, postable, problem: accountsProblem, status: accountsStatus } = useAccounts();
  const { busy: submitting, run: runSubmit } = useSubmitLock();
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState(emptyForm());
  const [bulkLines, setBulkLines] = useState([{ ...emptyLine }, { ...emptyLine }]);
  const [bulkDate, setBulkDate] = useState(todayLocal());
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [bulkBranch, setBulkBranch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  React.useEffect(() => { setPage(1); }, [search, filterCategory, filterBranch, filterDateFrom, filterDateTo, pageSize, activeBranch]);

  // When a specific branch is active in the navbar, the branch filter is
  // scoped to it (even for admins); "All Branches" in the navbar unlocks it.
  const branchLocked = activeBranch !== "all";
  const activeBranchName = activeBranch === "main"
    ? "Main Office"
    : (branches.find(b => b.id === activeBranch)?.name || "");
  useEffect(() => { if (branchLocked) setFilterBranch(""); }, [branchLocked, activeBranch]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "expenses"), snap =>
      setExpenses(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.date) - new Date(a.date))
      )
    );
    return () => { unsub(); };
  }, []);

  const openModal = () => {
    setForm({ ...emptyForm(), paidAccountId: "" });
    setBulkDate(todayLocal());
    setBulkAccountId("");
    setShowModal(true);
  };

  const filtered = expenses.filter(e => {
    const matchBranch = matchesBranch(e, activeBranch) && (!filterBranch || e.branchId === filterBranch);
    const matchCat = !filterCategory || e.category === filterCategory;
    const matchFrom = !filterDateFrom || e.date >= filterDateFrom;
    const matchTo = !filterDateTo || e.date <= filterDateTo;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (e.description || "").toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q);
    return matchBranch && matchCat && matchFrom && matchTo && matchSearch;
  });

  // pagination over the filtered set
  const rowCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const total = sumMoney(filtered.map(e => e.amount));

  // multi-select for bulk actions
  const bulk = useBulkSelect(filtered.map(e => e.id));
  const pagedIds = paged.map(e => e.id);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleDelete = async (exp) => {
    if (!window.confirm("Delete this expense? If it was paid from an account, the payment will be reversed. You can restore it from Trash.")) return;
    try {
      await reverseSourcePayments("expense", exp.id);
      await deleteDoc(doc(db, "expenses", exp.id));
      toast.success("Expense deleted");
      logActivity("deleted", "Expenses", `${exp.description} · Rs. ${Number(exp.amount || 0).toLocaleString()}`);
    } catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} expense${ids.length === 1 ? "" : "s"}? Payments made from accounts will be reversed. You can restore them from Trash.`)) return;
    setBulkBusy(true);
    const t = toast.loading(`Deleting ${ids.length} expenses…`);
    try {
      const { ok, failed } = await runBulk(ids, (id) => reverseSourcePayments("expense", id), {
        onProgress: (d, tot) => toast.loading(`Reversing payments ${d}/${tot}…`, { id: t }),
      });
      if (ok.length) await deleteDocs("expenses", ok);
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "moved to Trash", "expenses"), { id: t });
      if (ok.length) logActivity("deleted", "Expenses", `${ok.length} expenses (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed", { id: t });
    } finally { setBulkBusy(false); }
  };

  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      // "main" is the UI sentinel for the Main branch (stored as "").
      if (changes.branchId === "main") changes.branchId = "";
      // The date and branch of an expense that was paid from an account must
      // match its cash entry, so those two fields are only changed on unpaid
      // expenses. Category is safe for all of them.
      const movesMoney = "date" in changes || "branchId" in changes;
      const chosen = expenses.filter(e => bulk.selected.has(e.id));
      const editable = movesMoney ? chosen.filter(e => !e.paidAccount) : chosen;
      const skipped = chosen.length - editable.length;
      if (editable.length === 0) { toast.error("Paid expenses can't have their date or branch changed in bulk. Delete (reverses the payment) and re-enter instead."); return; }
      const n = editable.length;
      await updateDocs("expenses", editable.map(e => e.id), { ...changes, updatedAt: serverTimestamp() });
      toast.success(`${n} expense${n === 1 ? "" : "s"} updated${skipped ? ` · ${skipped} paid expense${skipped === 1 ? "" : "s"} skipped (date/branch locked)` : ""}`);
      logActivity("updated", "Expenses", `${n} expenses (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  const handleSingle = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      try {
        const { paidAccountId, ...expense } = form;
        const res = await createExpenseAndPost({ expense, accounts, accountId: paidAccountId });
        const acctName = accounts.find(a => a.id === paidAccountId)?.name || "";
        if (res.paid && !res.posted) {
          // Never a plain success: the expense exists but its cash_out does not.
          toast.error(`Expense saved, but the payment was NOT recorded (${res.error?.message || "unknown error"}). It is flagged as not posted.`, { duration: 9000 });
        } else {
          rememberAccountChoice(paidAccountId);
          toast.success("Expense added");
        }
        logActivity("created", "Expenses", `${form.description} · Rs. ${formatMoney(form.amount)}${paidAccountId ? ` paid from ${acctName}${res.posted ? "" : " (NOT posted)"}` : ""}`);
        setShowModal(false);
        setForm(emptyForm());
      } catch (err) {
        toast.error(err?.message || "Could not save the expense", { duration: 7000 });
      }
    });
  };

  const handleBulk = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      const valid = bulkLines.filter(l => l.description && l.amount && l.category);
      if (valid.length === 0) return toast.error("Add at least one valid row");
      for (const l of valid) {
        const a = parsePositiveAmount(l.amount, `Amount for "${l.description}"`);
        if (!a.ok) return toast.error(a.error);
      }
      if (!isIsoDate(bulkDate)) return toast.error("Enter a valid date");
      let ok = 0, unposted = 0;
      const failures = [];
      for (const line of valid) {
        try {
          const res = await createExpenseAndPost({
            expense: { ...line, date: bulkDate, branchId: bulkBranch },
            accounts, accountId: bulkAccountId,
          });
          ok++;
          if (res.paid && !res.posted) unposted++;
        } catch (err) {
          failures.push(`${line.description}: ${err?.message || "failed"}`);
        }
      }
      if (bulkAccountId) rememberAccountChoice(bulkAccountId);
      if (failures.length || unposted) {
        toast.error(`${ok} saved${unposted ? ` (${unposted} NOT posted to the books)` : ""}${failures.length ? `, ${failures.length} failed: ${failures.slice(0, 3).join("; ")}` : ""}`, { duration: 9000 });
      } else {
        toast.success(`${ok} expenses added${bulkAccountId ? " and posted" : ""}`);
      }
      if (ok > 0) logActivity("created", "Expenses", `${ok} expenses (bulk entry)${bulkAccountId ? ` paid from ${accounts.find(a => a.id === bulkAccountId)?.name || "account"}` : ""}`);
      if (failures.length === 0) {
        setShowModal(false);
        setBulkLines([{ ...emptyLine }, { ...emptyLine }]);
        setBulkDate(todayLocal());
        setBulkBranch("");
      } else {
        const failedDescs = new Set(failures.map(f => f.split(":")[0]));
        setBulkLines(valid.filter(l => failedDescs.has(l.description))); // retry only the failures
      }
    });
  };

  const updateBulkLine = (idx, field, value) =>
    setBulkLines(p => p.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const bulkTotal = sumMoney(bulkLines.map(l => l.amount));

  const handleCSV = () => exportToCSV("expenses",
    ["Date", "Description", "Category", "Branch", "Amount"],
    filtered.map(e => [e.date, e.description, e.category, branches.find(b => b.id === e.branchId)?.name || "Main", e.amount])
  );

  const handlePDF = () => exportToPDF("Expenses Report",
    ["Date", "Description", "Category", "Branch", "Amount"],
    filtered.map(e => [e.date, e.description, e.category, branches.find(b => b.id === e.branchId)?.name || "Main", `Rs. ${Number(e.amount).toLocaleString()}`])
  );

  const clearFilters = () => { setSearch(""); setFilterCategory(""); setFilterBranch(""); setFilterDateFrom(""); setFilterDateTo(""); };
  const hasFilters = search || filterCategory || filterBranch || filterDateFrom || filterDateTo;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Expenses</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            Total: <strong style={{ color: "#ef4444" }}>Rs. {formatMoney(total)}</strong>
            <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>({filtered.length} entries)</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && (
            <>
              {can("canExport") && <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
                <Download size={14} /> CSV
              </button>}
              {can("canExport") && <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
                <FileText size={14} /> PDF
              </button>}
            </>
          )}
          <button onClick={openModal}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={15} /> Add Expense
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description, notes..."
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", flex: isMobile ? 1 : "none" }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        {!isMobile && (
          <select value={branchLocked ? "" : filterBranch} onChange={e => setFilterBranch(e.target.value)}
            disabled={branchLocked}
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}>
            {branchLocked ? (
              <option value="">{activeBranchName}</option>
            ) : (
              <>
                <option value="">All Branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </>
            )}
          </select>
        )}
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, flex: isMobile ? 1 : "none" }} />
        {!isMobile && (
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
        )}
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13, color: "var(--text-muted)" }}>
            Clear
          </button>
        )}
      </div>

      {/* Mobile card view */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map(exp => (
            <div key={exp.id} style={{ background: "white", borderRadius: 12, padding: 16, border: bulk.isSelected(exp.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, marginRight: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3 }}>
                    <RowCheckbox checked={bulk.isSelected(exp.id)} onChange={() => bulk.toggle(exp.id)} label={`Select expense ${exp.description}`} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{exp.description}{exp.ledgerPosted === false && <span title={exp.unpostedReason || "Payment was not posted to the books"} style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#b45309" }}>NOT POSTED</span>}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{exp.date}</div>
                  </div>
                </div>
                {can("canDeleteExpenses") && <button onClick={() => handleDelete(exp)}
                  style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, background: "#f1f5f9", color: "#475569", fontWeight: 500 }}>
                    {exp.category}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                    {branches.find(b => b.id === exp.branchId)?.name || "Main"}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#ef4444" }}>
                  Rs. {Number(exp.amount).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)" }}>
              No expenses found
            </div>
          )}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                  </th>
                  {["Date", "Description", "Category", "Branch", "Amount", ""].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(exp => (
                  <tr key={exp.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(exp.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "11px 6px 11px 14px" }}>
                      <RowCheckbox checked={bulk.isSelected(exp.id)} onChange={() => bulk.toggle(exp.id)} label={`Select expense ${exp.description}`} />
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{exp.date}</td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>
                      {exp.description}
                      {exp.ledgerPosted === false && <span title={exp.unpostedReason || "Payment was not posted to the books"} style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#fef3c7", color: "#b45309" }}>NOT POSTED</span>}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, background: "#f1f5f9", color: "#475569" }}>
                        {exp.category}
                      </span>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{branches.find(b => b.id === exp.branchId)?.name || "Main"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600, color: "#ef4444", whiteSpace: "nowrap" }}>
                      Rs. {Number(exp.amount).toLocaleString()}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      {can("canDeleteExpenses") && <button onClick={() => handleDelete(exp)}
                        style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
                        <Trash2 size={13} />
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No expenses found</div>
          )}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={rowCount} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="expenses"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map(e => e.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          ...(can("canDeleteExpenses") ? [{ label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete }] : []),
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} expense${bulk.count === 1 ? "" : "s"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "category", label: "Category", type: "select", options: CATEGORIES.map(c => ({ value: c, label: c })) },
            { key: "date", label: "Date", type: "date" },
            { key: "branchId", label: "Branch", type: "select", options: [{ value: "main", label: "Main" }, ...branches.map(b => ({ value: b.id, label: b.name }))] },
          ]}
        />
      )}

      {/* Add Expense Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : (mode === "bulk" ? 660 : 480), maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Add Expense</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#f8fafc", padding: 4, borderRadius: 8 }}>
              {["single", "bulk"].map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: mode === m ? "white" : "transparent", color: mode === m ? "var(--primary)" : "var(--text-muted)", transition: "all 0.15s" }}>
                  {m === "single" ? "Single Entry" : "Bulk Entry"}
                </button>
              ))}
            </div>

            {/* Single form */}
            {mode === "single" && (
              <form onSubmit={handleSingle}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                  <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Description</label>
                    <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Amount (Rs.)</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Date</label>
                    <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Select</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Branch</label>
                    <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Main</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Paid from account <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional — leave blank if unpaid)</span>
                    </label>
                    <select value={form.paidAccountId} onChange={e => setForm(p => ({ ...p, paidAccountId: e.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Not paid yet</option>
                      {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {postable.length === 0 && accountsStatus !== "loading" && (
                      <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>{accountsProblem}</div>
                    )}
                  </div>
                  <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Notes (optional)</label>
                    <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                  <button type="submit" disabled={submitting}
                    style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontWeight: 600, fontSize: 14 }}>{submitting ? "Saving..." : "Save Expense"}</button>
                </div>
              </form>
            )}

            {/* Bulk form */}
            {mode === "bulk" && (
              <form onSubmit={handleBulk}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Date (all rows)</label>
                    <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} required
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Branch (all rows)</label>
                    <select value={bulkBranch} onChange={e => setBulkBranch(e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Main</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                    Paid from account <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional, posts every row to the books)</span>
                  </label>
                  <select value={bulkAccountId} onChange={e => setBulkAccountId(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Not paid yet</option>
                    {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                  {!isMobile && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 110px 36px", background: "#f8fafc", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", gap: 8 }}>
                      <span>Description</span><span>Category</span><span>Amount</span><span></span>
                    </div>
                  )}
                  {bulkLines.map((line, idx) => (
                    <div key={idx} style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 140px 110px 36px",
                      padding: "10px 12px",
                      borderTop: "1px solid var(--border)",
                      gap: isMobile ? 8 : 8,
                      alignItems: "center"
                    }}>
                      <input value={line.description} onChange={e => updateBulkLine(idx, "description", e.target.value)} placeholder="Description"
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }} />
                      <select value={line.category} onChange={e => updateBulkLine(idx, "category", e.target.value)}
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }}>
                        <option value="">Category</option>
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="number" min="0.01" step="0.01" value={line.amount} onChange={e => updateBulkLine(idx, "amount", e.target.value)} placeholder="0"
                          style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }} />
                        {bulkLines.length > 1 && (
                          <button type="button" onClick={() => setBulkLines(p => p.filter((_, i) => i !== idx))}
                            style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
                    <button type="button" onClick={() => setBulkLines(p => [...p, { ...emptyLine }])}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", background: "var(--primary-light)", color: "var(--primary)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      <Plus size={13} /> Add Row
                    </button>
                    <strong style={{ fontSize: 14 }}>Total: Rs. {formatMoney(bulkTotal)}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                  <button type="submit" disabled={submitting}
                    style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontWeight: 600, fontSize: 14 }}>
                    {submitting ? "Saving..." : `Save ${bulkLines.filter(l => l.description && l.amount).length} Expenses`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}