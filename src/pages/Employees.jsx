import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import { useBulkSelect } from "../hooks/useBulkSelect";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import BulkBar, { RowCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import { exportToCSV, exportToPDF } from "../utils/exportUtils";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Edit2, Download, FileText } from "lucide-react";

const empty = { name: "", role: "", phone: "", email: "", branchId: "", salary: "", joinDate: "", recurringPayslip: false };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function Employees() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [filterRole, setFilterRole] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { rows: employees, filtered, paged, total, pageCount, page: safePage } = useCollection("employees", {
    activeBranch,
    search,
    searchFields: ["name", "role", "phone", "email"],
    filters: { role: filterRole },
    sortBy: sortField,
    sortDir,
    page,
    pageSize,
  });

  const roles = [...new Set(employees.map(e => e.role).filter(Boolean))];
  const active = !!(search || filterRole || sortField);

  // multi-select for bulk actions
  const bulk = useBulkSelect(filtered.map(e => e.id));
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleDeleteOne = async (emp) => {
    if (!window.confirm("Delete this employee? You can restore them from Trash.")) return;
    try {
      await deleteDoc(doc(db, "employees", emp.id));
      toast.success("Employee moved to Trash");
      logActivity("deleted", "Employees", `${emp.name}${emp.role ? ` — ${emp.role}` : ""}`);
    } catch (err) { toast.error(err?.message || "Error deleting"); }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} employee${ids.length === 1 ? "" : "s"}? Their payslips are kept. You can restore employees from Trash.`)) return;
    setBulkBusy(true);
    try {
      await deleteDocs("employees", ids);
      toast.success(bulkResultMessage(ids.length, 0, "moved to Trash", "employees"));
      logActivity("deleted", "Employees", `${ids.length} employees (bulk)`);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk delete failed");
    } finally { setBulkBusy(false); }
  };

  const handleBulkEditApply = async (changes) => {
    setBulkBusy(true);
    try {
      const n = bulk.count;
      if (changes.branchId === "main") changes.branchId = "";
      await updateDocs("employees", [...bulk.selected], { ...changes, updatedAt: serverTimestamp() });
      toast.success(`${n} employee${n === 1 ? "" : "s"} updated`);
      logActivity("updated", "Employees", `${n} employees (bulk): ${Object.keys(changes).join(", ")}`);
      setShowBulkEdit(false);
      bulk.clear();
    } catch (err) {
      toast.error(err?.message || "Bulk update failed");
    } finally { setBulkBusy(false); }
  };

  React.useEffect(() => { setPage(1); }, [search, filterRole, pageSize, activeBranch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateDoc(doc(db, "employees", editing), { ...form, updatedAt: serverTimestamp() });
        toast.success("Employee updated");
        logActivity("updated", "Employees", `${form.name}${form.role ? ` — ${form.role}` : ""}`);
      } else {
        await addDoc(collection(db, "employees"), { ...form, createdAt: serverTimestamp() });
        toast.success("Employee added");
        logActivity("created", "Employees", `${form.name}${form.role ? ` — ${form.role}` : ""}`);
      }
      setShowModal(false); setForm(empty); setEditing(null);
    } catch { toast.error("Error saving"); }
  };

  const handleCSV = () => exportToCSV("employees",
    ["Name", "Role", "Phone", "Email", "Branch", "Salary", "Auto Payslip"],
    filtered.map(e => [e.name, e.role, e.phone, e.email, branches.find(b => b.id === e.branchId)?.name || "Main", e.salary, e.recurringPayslip ? "Yes" : "No"])
  );

  const handlePDF = () => exportToPDF("Employees Report",
    ["Name", "Role", "Phone", "Branch", "Salary"],
    filtered.map(e => [e.name, e.role, e.phone, branches.find(b => b.id === e.branchId)?.name || "Main", `Rs. ${Number(e.salary || 0).toLocaleString()}`])
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Employees / Teachers <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMobile && <>
            <button onClick={handleCSV} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><Download size={14} /> CSV</button>
            <button onClick={handlePDF} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}><FileText size={14} /> PDF</button>
          </>}
          <button onClick={() => { setForm(empty); setEditing(null); setShowModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, role, phone, email..."
        filters={[
          { key: "role", value: filterRole, onChange: setFilterRole, placeholder: "All Roles", options: roles.map(r => ({ value: r, label: r })) },
        ]}
        sort={{
          field: sortField, dir: sortDir,
          onSortField: setSortField,
          onToggleDir: () => setSortDir(d => (d === "asc" ? "desc" : "asc")),
          options: [
            { value: "name", label: "Name" },
            { value: "role", label: "Role" },
            { value: "salary", label: "Salary" },
          ],
        }}
        active={active}
        onClear={() => { setSearch(""); setFilterRole(""); setSortField(""); setSortDir("asc"); }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {paged.map(emp => (
          <div key={emp.id} style={{ background: "white", borderRadius: 12, padding: 20, border: bulk.isSelected(emp.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <RowCheckbox checked={bulk.isSelected(emp.id)} onChange={() => bulk.toggle(emp.id)} label={`Select ${emp.name}`} />
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                  {emp.name?.charAt(0)?.toUpperCase()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setForm(emp); setEditing(emp.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                <button onClick={() => handleDeleteOne(emp)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.name}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>{emp.role}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{emp.phone}</div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{branches.find(b => b.id === emp.branchId)?.name || "Main Office"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>Rs. {Number(emp.salary || 0).toLocaleString()}/mo</span>
              </div>
              {emp.recurringPayslip && <span style={{ display: "inline-block", marginTop: 8, padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>Auto payslip</span>}
            </div>
          </div>
        ))}
      </div>
      {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)", marginTop: 8 }}>No employees found</div>}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {/* Bulk actions bar */}
      <BulkBar
        count={bulk.count}
        total={filtered.length}
        noun="employees"
        busy={bulkBusy}
        onSelectAll={() => bulk.selectAll(filtered.map(e => e.id))}
        onClear={bulk.clear}
        actions={[
          { label: "Edit", icon: Edit2, onClick: () => setShowBulkEdit(true) },
          { label: "Delete", icon: Trash2, variant: "danger", onClick: handleBulkDelete },
        ]}
      />

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <BulkEditModal
          title={`Edit ${bulk.count} employee${bulk.count === 1 ? "" : "s"}`}
          busy={bulkBusy}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEditApply}
          fields={[
            { key: "branchId", label: "Branch", type: "select", options: [{ value: "main", label: "Main Office" }, ...branches.map(b => ({ value: b.id, label: b.name }))] },
            { key: "salary", label: "Monthly Salary (Rs.)", type: "number", placeholder: "e.g. 30000", hint: "Applies to future payslips only — existing payslips keep their amounts." },
            { key: "recurringPayslip", label: "Auto-recurring payslip", type: "boolean" },
          ]}
        />
      )}

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 16 }}>
          <div style={{ background: "white", borderRadius: isMobile ? "20px 20px 0 0" : 16, padding: isMobile ? "24px 20px" : 32, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? "Edit Employee" : "Add Employee"}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Full Name", key: "name", required: true },
                  { label: "Role / Position", key: "role" },
                  { label: "Phone", key: "phone" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Monthly Salary (Rs.)", key: "salary", type: "number" },
                  { label: "Join Date", key: "joinDate", type: "date" },
                ].map(({ label, key, type = "text", required }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                    <input type={type} value={form[key] || ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required={required}
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Branch</label>
                  <select value={form.branchId || ""} onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}>
                    <option value="">Main Office</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: isMobile ? "1" : "span 2", display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: form.recurringPayslip ? "#f0fdf4" : "#f8fafc" }}>
                  <input type="checkbox" id="recurringPayslip" checked={form.recurringPayslip || false} onChange={e => setForm(p => ({ ...p, recurringPayslip: e.target.checked }))} style={{ width: 18, height: 18 }} />
                  <div>
                    <label htmlFor="recurringPayslip" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Auto-generate monthly payslip</label>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Payslip auto-created each month</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); setForm(empty); }} style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 2, padding: "10px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>{editing ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}