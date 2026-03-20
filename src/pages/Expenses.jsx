import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Download, FileText } from "lucide-react";

const CATEGORIES = ["Rent", "Utilities", "Salaries", "Supplies", "Maintenance", "Transport", "Other"];
const emptyLine = { description: "", amount: "", category: "" };

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
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [expenses, setExpenses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState({ description: "", amount: "", category: "", date: "", branchId: "", notes: "" });
  const [bulkLines, setBulkLines] = useState([{ ...emptyLine }, { ...emptyLine }]);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkBranch, setBulkBranch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "expenses"), snap =>
      setExpenses(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.date) - new Date(a.date))
      )
    );
    return unsub;
  }, []);

  const filtered = expenses.filter(e => {
    const matchBranch = (activeBranch === "all" || e.branchId === activeBranch) && (!filterBranch || e.branchId === filterBranch);
    const matchCat = !filterCategory || e.category === filterCategory;
    const matchFrom = !filterDateFrom || e.date >= filterDateFrom;
    const matchTo = !filterDateTo || e.date <= filterDateTo;
    return matchBranch && matchCat && matchFrom && matchTo;
  });

  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

  const handleSingle = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "expenses"), { ...form, createdAt: serverTimestamp() });
    toast.success("Expense added");
    setShowModal(false);
    setForm({ description: "", amount: "", category: "", date: "", branchId: "", notes: "" });
  };

  const handleBulk = async (e) => {
    e.preventDefault();
    const valid = bulkLines.filter(l => l.description && l.amount && l.category);
    if (valid.length === 0) return toast.error("Add at least one valid row");
    await Promise.all(valid.map(line =>
      addDoc(collection(db, "expenses"), { ...line, date: bulkDate, branchId: bulkBranch, createdAt: serverTimestamp() })
    ));
    toast.success(`${valid.length} expenses added`);
    setShowModal(false);
    setBulkLines([{ ...emptyLine }, { ...emptyLine }]);
    setBulkDate("");
    setBulkBranch("");
  };

  const updateBulkLine = (idx, field, value) =>
    setBulkLines(p => p.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const bulkTotal = bulkLines.reduce((s, l) => s + Number(l.amount || 0), 0);

  const handleCSV = () => exportToCSV("expenses",
    ["Date", "Description", "Category", "Branch", "Amount"],
    filtered.map(e => [e.date, e.description, e.category, branches.find(b => b.id === e.branchId)?.name || "Main", e.amount])
  );

  const handlePDF = () => exportToPDF("Expenses Report",
    ["Date", "Description", "Category", "Branch", "Amount"],
    filtered.map(e => [e.date, e.description, e.category, branches.find(b => b.id === e.branchId)?.name || "Main", `Rs. ${Number(e.amount).toLocaleString()}`])
  );

  const clearFilters = () => { setFilterCategory(""); setFilterBranch(""); setFilterDateFrom(""); setFilterDateTo(""); };
  const hasFilters = filterCategory || filterBranch || filterDateFrom || filterDateTo;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Expenses</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            Total: <strong style={{ color: "#ef4444" }}>Rs. {total.toLocaleString()}</strong>
            <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>({filtered.length} entries)</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && (
            <>
              <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
                <Download size={14} /> CSV
              </button>
              <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
                <FileText size={14} /> PDF
              </button>
            </>
          )}
          <button onClick={() => setShowModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            <Plus size={15} /> Add Expense
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white", flex: isMobile ? 1 : "none" }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        {!isMobile && (
          <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "white" }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
          {filtered.map(exp => (
            <div key={exp.id} style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, marginRight: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{exp.description}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{exp.date}</div>
                </div>
                <button onClick={() => deleteDoc(doc(db, "expenses", exp.id))}
                  style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "7px 9px", borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
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
                  {["Date", "Description", "Category", "Branch", "Amount", ""].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(exp => (
                  <tr key={exp.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{exp.date}</td>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 500 }}>{exp.description}</td>
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
                      <button onClick={() => deleteDoc(doc(db, "expenses", exp.id))}
                        style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
                        <Trash2 size={13} />
                      </button>
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
                    <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required
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
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Notes (optional)</label>
                    <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                  <button type="submit"
                    style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Save Expense</button>
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
                        <input type="number" value={line.amount} onChange={e => updateBulkLine(idx, "amount", e.target.value)} placeholder="0"
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
                    <strong style={{ fontSize: 14 }}>Total: Rs. {bulkTotal.toLocaleString()}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ flex: 1, padding: "11px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
                  <button type="submit"
                    style={{ flex: 2, padding: "11px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    Save {bulkLines.filter(l => l.description && l.amount).length} Expenses
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