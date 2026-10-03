import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { doc, getDoc, serverTimestamp, updateDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import { useBulkSelect } from "../hooks/useBulkSelect";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { runBulk, bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { postManualPayment, reversePayment, isReversalRow, isPostedBySource, pickDefaultAccountId, rememberAccountChoice } from "../utils/accounting";
import { parsePositiveAmount, sumMoney, todayLocal, isIsoDate, formatMoney } from "../utils/money";
import { useAccounts } from "../utils/useAccounts";
import { useSubmitLock } from "../utils/useSubmitLock";
import { receiptFromPayment, buildReceiptHtml, openPrintWindow } from "../utils/invoiceGenerator";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, X, ArrowUpCircle, ArrowDownCircle, Undo2, Download, FileText, Pencil, Printer, Trash2 } from "lucide-react";

const CATEGORIES = ["Fee Collection", "Salary Payment", "Rent", "Utilities", "Supplies", "Maintenance", "Bank Deposit", "Bank Withdrawal", "Other"];
const emptyLine = { accountId: "", description: "", category: "", amount: "", type: "cash_out" };
const emptyForm = () => ({ type: "cash_in", accountId: "", description: "", amount: "", date: todayLocal(), reference: "", branchId: "", category: "" });

// A payment can be reversed directly only when it is a manual entry that
// is neither already reversed nor itself a reversal. Rows created by an
// invoice / expense / payslip are changed through that document, so the
// document and the ledger never disagree (ACC-02).
const reverseBlockReason = (p) => {
  if (isReversalRow(p)) return "This is a reversal entry and cannot be reversed again.";
  if (p.reversed) return "This payment has already been reversed.";
  if (isPostedBySource(p)) return `This payment belongs to ${p.source === "payslip" ? "a payslip" : p.source === "expense" ? "an expense" : "an invoice"}. Delete or edit that document instead; its payments are reversed for you.`;
  return "";
};
const canPrintReceipt = (p) => p.type === "cash_in" && !p.reversed && !isReversalRow(p) && !!p.id && isIsoDate(p.date) && (p.source === "invoice" || p.category === "Fee Collection");

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Payments() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const { accounts, postable, problem: accountsProblem, status: accountsStatus } = useAccounts();
  const { busy: submitting, run: runSubmit } = useSubmitLock();
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState(emptyForm());
  const [bulkLines, setBulkLines] = useState([{ ...emptyLine }, { ...emptyLine }]);
  const [bulkDate, setBulkDate] = useState(todayLocal());
  const [bulkRef, setBulkRef] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // payments via the shared hook: realtime + search + filters + sort + paging
  const { filtered, paged, total, pageCount, page: safePage } = useCollection("payments", {
    activeBranch,
    search,
    searchFields: ["description", "account", "reference", "category"],
    filters: { type: filterType, category: filterCategory, dateFrom: filterDateFrom, dateTo: filterDateTo },
    filterFns: {
      dateFrom: (row, val) => !val || (row.date || "") >= val,
      dateTo: (row, val) => !val || (row.date || "") <= val,
    },
    sortBy: "date",
    sortDir: "desc",
    page,
    pageSize,
  });

  useEffect(() => { setPage(1); }, [search, filterType, filterCategory, filterDateFrom, filterDateTo, pageSize, activeBranch]);

  // multi-select for bulk actions
  const bulk = useBulkSelect(filtered.map(p => p.id));
  const pagedIds = paged.map(p => p.id);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const totalIn = sumMoney(filtered.filter(p => p.type === "cash_in").map(p => p.amount));
  const totalOut = sumMoney(filtered.filter(p => p.type === "cash_out").map(p => p.amount));

  const openModal = () => {
    setForm({ ...emptyForm(), accountId: pickDefaultAccountId(postable) });
    setBulkDate(todayLocal());
    setShowModal(true);
  };

  const handleSingle = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      if (!form.accountId) return toast.error("Select the account");
      try {
        await postManualPayment({ accounts, ...form });
        rememberAccountChoice(form.accountId);
        const acctName = accounts.find(a => a.id === form.accountId)?.name || "";
        toast.success("Payment recorded");
        logActivity("recorded", "Payments", `${form.type === "cash_in" ? "Cash in" : "Cash out"} Rs. ${formatMoney(form.amount)} — ${acctName}${form.description ? ` (${form.description})` : ""}`);
        setShowModal(false);
        setForm(emptyForm());
      } catch (err) {
        toast.error(err?.message || "Could not record the payment", { duration: 7000 });
      }
    });
  };

  const handleBulk = (e) => {
    e.preventDefault();
    return runSubmit(async () => {
      const valid = bulkLines.filter(l => l.accountId && l.amount && l.description);
      if (valid.length === 0) return toast.error("Add at least one valid line");
      // validate every line before writing any
      for (const l of valid) {
        const a = parsePositiveAmount(l.amount, `Amount for "${l.description}"`);
        if (!a.ok) return toast.error(a.error);
      }
      if (!isIsoDate(bulkDate)) return toast.error("Enter a valid date");
      let ok = 0;
      const failures = [];
      for (const line of valid) {
        try {
          await postManualPayment({ accounts, ...line, date: bulkDate, reference: bulkRef });
          ok++;
        } catch (err) {
          failures.push(`${line.description}: ${err?.message || "failed"}`);
        }
      }
      if (failures.length) {
        toast.error(`${ok} recorded, ${failures.length} failed: ${failures.slice(0, 3).join("; ")}`, { duration: 9000 });
        // keep only the failed lines so a retry cannot duplicate the good ones
        const failedDescs = new Set(failures.map(f => f.split(":")[0]));
        setBulkLines(valid.filter(l => failedDescs.has(l.description)));
      } else {
        toast.success(`${ok} payments recorded`);
        setShowModal(false);
        setBulkLines([{ ...emptyLine }, { ...emptyLine }]);
        setBulkRef("");
      }
      if (ok > 0) logActivity("recorded", "Payments", `${ok} payments (bulk entry)`);
    });
  };

  // Posted money is never deleted or edited in place: it is reversed with an
  // equal-and-opposite entry, and both rows stay in the ledger.
  const handleReverse = (p) => runSubmit(async () => {
    const why = reverseBlockReason(p);
    if (why) return toast.error(why, { duration: 6000 });
    if (!window.confirm("Reverse this payment? An equal and opposite entry is posted and both stay in the ledger.")) return;
    try {
      const id = await reversePayment(p);
      if (!id) return toast("This payment was already reversed");
      toast.success("Payment reversed");
      logActivity("reversed", "Payments", `${p.type === "cash_in" ? "Cash in" : "Cash out"} Rs. ${formatMoney(p.amount || 0)} — ${p.account}${p.description ? ` (${p.description})` : ""}`);
    } catch (err) { toast.error(err?.message || "Could not reverse the payment"); }
  });

  const handleBulkReverse = () => runSubmit(async () => {
    const rows = filtered.filter(p => bulk.selected.has(p.id));
    const eligible = rows.filter(p => !reverseBlockReason(p));
    const skipped = rows.length - eligible.length;
    if (eligible.length === 0) return toast.error("None of the selected payments can be reversed here (already reversed, reversal entries, or posted from an invoice, expense or payslip).", { duration: 7000 });
    if (!window.confirm(`Reverse ${eligible.length} payment${eligible.length === 1 ? "" : "s"}?${skipped ? ` ${skipped} selected row${skipped === 1 ? "" : "s"} cannot be reversed here and will be skipped.` : ""}`)) return;
    setBulkBusy(true);
    try {
      const { ok, failed } = await runBulk(eligible, (p) => reversePayment(p), { chunkSize: 3 });
      toast[failed.length ? "error" : "success"](bulkResultMessage(ok.length, failed.length, "reversed", "payments") + (skipped ? ` · ${skipped} skipped` : ""));
      if (ok.length) logActivity("reversed", "Payments", `${ok.length} payments (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk reverse failed");
    } finally { setBulkBusy(false); }
  });

  // Category is the only field that is safe to change on posted payments:
  // account, date and branch move money between balances and periods.
  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const rows = filtered.filter(p => bulk.selected.has(p.id) && !isReversalRow(p));
      if (rows.length === 0) { toast.error("Reversal entries cannot be edited"); return; }
      await updateDocs("payments", rows.map(p => p.id), { category: changes.category, updatedAt: serverTimestamp() });
      toast.success(`${rows.length} payment${rows.length === 1 ? "" : "s"} updated`);
      logActivity("updated", "Payments", `${rows.length} payments (bulk): category`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  const handlePrintReceipt = async (p) => {
    try {
      let invoice = null;
      if (p.source === "invoice" && p.sourceId) {
        try {
          const snap = await getDoc(doc(db, "invoices", p.sourceId));
          if (snap.exists()) invoice = snap.data();
        } catch { /* fall back to the payment description */ }
      }
      const data = receiptFromPayment({ payment: p, invoice, branches, printedOn: todayLocal() });
      if (!openPrintWindow(buildReceiptHtml(data))) toast.error("Pop-up blocked. Allow pop-ups for this site to print the receipt.");
      else logActivity("printed", "Payments", `Receipt ${data.receiptNo}`);
    } catch (err) {
      toast.error(err?.message || "Could not build the receipt");
    }
  };

  const updateBulkLine = (idx, field, value) =>
    setBulkLines(p => p.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const bulkTotal = sumMoney(bulkLines.map(l => l.amount));

  const handleCSV = () => exportToCSV("payments",
    ["Date", "Type", "Account", "Category", "Description", "Reference", "Amount"],
    filtered.map(p => [p.date, p.type === "cash_in" ? "Cash In" : "Cash Out", p.account, p.category, p.description, p.reference, p.amount])
  );

  const handlePDF = () => exportToPDF("Payments Report",
    ["Date", "Type", "Account", "Description", "Amount"],
    filtered.map(p => [p.date, p.type === "cash_in" ? "Cash In" : "Cash Out", p.account, p.description, `Rs. ${Number(p.amount).toLocaleString()}`])
  );

  const clearFilters = () => { setSearch(""); setFilterType(""); setFilterCategory(""); setFilterDateFrom(""); setFilterDateTo(""); };
  const hasFilters = search || filterType || filterCategory || filterDateFrom || filterDateTo;

  const modalStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center", zIndex: 1000,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Cash & Bank Payments</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <>
            <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
            <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          </>}
          <button onClick={openModal}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Add Payment
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Total Cash In", value: totalIn, color: "#10b981", bg: "#ecfdf5", icon: ArrowDownCircle },
          { label: "Total Cash Out", value: totalOut, color: "#ef4444", bg: "#fef2f2", icon: ArrowUpCircle },
          { label: "Net Balance", value: totalIn - totalOut, color: "#4f46e5", bg: "#eef2ff", icon: ArrowDownCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 700, color }}>Rs. {formatMoney(value)}</div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={18} color={color} />
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search description, account, reference..."
        filters={[
          { key: "type", value: filterType, onChange: setFilterType, placeholder: "All Types", options: [{ value: "cash_in", label: "Cash In" }, { value: "cash_out", label: "Cash Out" }] },
          { key: "category", value: filterCategory, onChange: setFilterCategory, placeholder: "All Categories", options: CATEGORIES.map(c => ({ value: c, label: c })) },
        ]}
        active={hasFilters}
        onClear={clearFilters}
        rightSlot={!isMobile ? (
          <>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} title="From date"
              style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} title="To date"
              style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
          </>
        ) : null}
      />

      {/* Mobile cards */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paged.map(p => (
            <div key={p.id} style={{ background: "white", borderRadius: 12, padding: 16, border: bulk.isSelected(p.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3 }}>
                    <RowCheckbox checked={bulk.isSelected(p.id)} onChange={() => bulk.toggle(p.id)} label={`Select payment ${p.description || p.id}`} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{p.description}{p.reversed && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#b45309" }}>REVERSED</span>}{isReversalRow(p) && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#64748b" }}>REVERSAL</span>}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{p.date} · {p.account}</div>
                  </div>
                </div>
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: p.type === "cash_in" ? "#ecfdf5" : "#fef2f2", color: p.type === "cash_in" ? "#10b981" : "#ef4444", flexShrink: 0, marginLeft: 8 }}>
                  {p.type === "cash_in" ? "In" : "Out"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, background: "#f1f5f9", color: "#475569" }}>{p.category}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: p.type === "cash_in" ? "#10b981" : "#ef4444" }}>
                    {p.type === "cash_in" ? "+" : "-"}Rs. {Number(p.amount).toLocaleString()}
                  </div>
                  {canPrintReceipt(p) && <button onClick={() => handlePrintReceipt(p)} title="Print receipt" style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 9px", borderRadius: 6, cursor: "pointer" }}><Printer size={13} /></button>}
                  <button onClick={() => handleReverse(p)} disabled={submitting} title={reverseBlockReason(p) || "Reverse this payment"} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 9px", borderRadius: 6, cursor: "pointer", opacity: reverseBlockReason(p) ? 0.45 : 1 }}><Undo2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
          {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12 }}>No payments found</div>}
        </div>
      ) : (
        /* Desktop table */
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                  </th>
                  {["Date", "Type", "Account", "Category", "Description", "Reference", "Amount"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  <th style={{ padding: "11px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)", background: bulk.isSelected(p.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "11px 6px 11px 14px" }}>
                      <RowCheckbox checked={bulk.isSelected(p.id)} onChange={() => bulk.toggle(p.id)} label={`Select payment ${p.description || p.id}`} />
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{p.date}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: p.type === "cash_in" ? "#ecfdf5" : "#fef2f2", color: p.type === "cash_in" ? "#10b981" : "#ef4444", whiteSpace: "nowrap" }}>
                        {p.type === "cash_in" ? "Cash In" : "Cash Out"}
                      </span>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{p.account}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>{p.category}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13 }}>
                      {p.description}
                      {p.reversed && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#fef3c7", color: "#b45309" }}>REVERSED</span>}
                      {isReversalRow(p) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#f1f5f9", color: "#64748b" }}>REVERSAL</span>}
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 12, fontFamily: "monospace" }}>{p.reference || "—"}</td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600, color: p.type === "cash_in" ? "#10b981" : "#ef4444", whiteSpace: "nowrap" }}>
                      {p.type === "cash_in" ? "+" : "-"}Rs. {Number(p.amount).toLocaleString()}
                    </td>
                    <td style={{ padding: "11px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {canPrintReceipt(p) && <button onClick={() => handlePrintReceipt(p)} title="Print receipt" style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "7px 9px", borderRadius: 8, cursor: "pointer", marginRight: 6 }}><Printer size={14} /></button>}
                      <button onClick={() => handleReverse(p)} disabled={submitting} title={reverseBlockReason(p) || "Reverse this payment"} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer", opacity: reverseBlockReason(p) ? 0.45 : 1 }}><Undo2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No payments found</div>}
        </div>
      )}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="payments"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map(p => p.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Pencil, onClick: () => setShowBulkEdit(true) },
          { label: "Reverse", icon: Undo2, variant: "danger", onClick: handleBulkReverse },
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} payment${bulk.count === 1 ? "" : "s"}`}
          note="Only the category can be changed on posted payments. To correct an account, date or amount, reverse the payment and record it again."
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "category", label: "Category", type: "select", options: CATEGORIES.map(c => ({ value: c, label: c })) },
          ]}
        />
      )}

      {/* Modal */}
      {showModal && (
        <div style={modalStyle}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: isMobile ? "100%" : (mode === "bulk" ? 700 : 520), maxHeight: "92vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Record Payment</h3>
              <button onClick={() => setShowModal(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#f8fafc", padding: 4, borderRadius: 8 }}>
              {["single", "bulk"].map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: mode === m ? "white" : "transparent", color: mode === m ? "var(--primary)" : "var(--text-muted)" }}>
                  {m === "single" ? "Single Payment" : "Bulk Payment"}
                </button>
              ))}
            </div>

            {/* Single form */}
            {mode === "single" && (
              <form onSubmit={handleSingle}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Payment Type</label>
                    <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="cash_in">Cash In</option>
                      <option value="cash_out">Cash Out</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Account</label>
                    {postable.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#ef4444" }}>{accountsStatus === "loading" ? "Loading accounts…" : accountsProblem}</div>
                    ) : (
                      <select value={form.accountId} onChange={e => setForm(p => ({ ...p, accountId: e.target.value }))} required
                        style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                        <option value="">Select account</option>
                        {postable.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} — ` : ""}{a.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Select</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount (Rs.)</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Date</label>
                    <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Reference #</label>
                    <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="e.g. CHQ-001"
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                    <select value={form.branchId} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                      <option value="">Main Office</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: isMobile ? "1" : "span 2" }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
                    <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                  <button type="button" onClick={() => setShowModal(false)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                  <button type="submit" disabled={submitting || postable.length === 0} style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: (submitting || postable.length === 0) ? "not-allowed" : "pointer", opacity: (submitting || postable.length === 0) ? 0.6 : 1, fontWeight: 600 }}>{submitting ? "Saving..." : "Save Payment"}</button>
                </div>
              </form>
            )}

            {/* Bulk form */}
            {mode === "bulk" && (
              <form onSubmit={handleBulk}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Date (all rows)</label>
                    <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} required
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Batch Reference</label>
                    <input value={bulkRef} onChange={e => setBulkRef(e.target.value)} placeholder="e.g. BATCH-001"
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                  {!isMobile && (
                    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 130px 100px 36px", background: "#f8fafc", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", gap: 8 }}>
                      <span>Type</span><span>Account</span><span>Description</span><span>Category</span><span>Amount</span><span></span>
                    </div>
                  )}
                  {bulkLines.map((line, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "110px 1fr 1fr 130px 100px 36px", padding: "10px 12px", borderTop: "1px solid var(--border)", gap: 8, alignItems: "center" }}>
                      <select value={line.type} onChange={e => updateBulkLine(idx, "type", e.target.value)}
                        style={{ padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                        <option value="cash_in">Cash In</option>
                        <option value="cash_out">Cash Out</option>
                      </select>
                      <select value={line.accountId} onChange={e => updateBulkLine(idx, "accountId", e.target.value)}
                        style={{ padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                        <option value="">Account</option>
                        {postable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <input value={line.description} onChange={e => updateBulkLine(idx, "description", e.target.value)} placeholder="Description"
                        style={{ padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} />
                      <select value={line.category} onChange={e => updateBulkLine(idx, "category", e.target.value)}
                        style={{ padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                        <option value="">Category</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input type="number" min="0.01" step="0.01" value={line.amount} onChange={e => updateBulkLine(idx, "amount", e.target.value)} placeholder="0"
                        style={{ padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} />
                      {bulkLines.length > 1 && (
                        <button type="button" onClick={() => setBulkLines(p => p.filter((_, i) => i !== idx))}
                          style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 8px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Trash2 size={14} />
                        </button>
                      )}
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
                  <button type="button" onClick={() => setShowModal(false)} style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                  <button type="submit" disabled={submitting || postable.length === 0} style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: (submitting || postable.length === 0) ? "not-allowed" : "pointer", opacity: (submitting || postable.length === 0) ? 0.6 : 1, fontWeight: 600 }}>
                    {submitting ? "Saving..." : `Save ${bulkLines.filter(l => l.accountId && l.amount).length} Payments`}
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