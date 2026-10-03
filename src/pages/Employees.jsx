import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDocs, deleteDocs } from "../firebase";
import { useBranch } from "../context/BranchContext";
import { useCollection } from "../hooks/useCollection";
import { useBulkSelect } from "../hooks/useBulkSelect";
import ListToolbar from "../components/UI/ListToolbar";
import Pagination from "../components/UI/Pagination";
import BulkBar, { RowCheckbox, HeaderCheckbox } from "../components/UI/BulkBar";
import BulkEditModal from "../components/UI/BulkEditModal";
import { bulkResultMessage } from "../utils/bulk";
import { logActivity } from "../utils/auditLog";
import ExportMenu from "../components/UI/ExportMenu";
import toast from "react-hot-toast";
import { Plus, Trash2, X, Edit2, CalendarCheck, LayoutGrid, List } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import RollCallModal from "../components/Profile/RollCallModal";

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

const VIEW_KEY = "employeesView";
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards"; } catch { return "cards"; }
};

const HistoricalTag = () => (
  <span title="Imported from the old books — hidden when History is off" style={{ display: "inline-block", marginLeft: 6, padding: "1px 7px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", verticalAlign: "middle" }}>Historical</span>
);

export default function Employees() {
  const { branches, activeBranch } = useBranch();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { can } = useUser();
  const [showRollCall, setShowRollCall] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [filterRole, setFilterRole] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useState(readView);
  const changeView = (v) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };

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
  const bulk = useBulkSelect(employees.map(e => e.id), activeBranch);
  const pagedIds = paged.map(e => e.id);
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

  const branchLabel = (e) => branches.find(b => b.id === e.branchId)?.name || "Main";
  const getExportData = () => ({
    headers: ["Name", "Role", "Phone", "Email", "Branch", "Salary", "Auto Payslip"],
    rows: filtered.map(e => [e.name, e.role, e.phone, e.email, branchLabel(e), Number(e.salary || 0), e.recurringPayslip ? "Yes" : "No"]),
    pdfHeaders: ["Name", "Role", "Phone", "Email", "Branch", "Salary"],
    pdfRows: filtered.map(e => [e.name, e.role, e.phone, e.email, branchLabel(e), `Rs. ${Number(e.salary || 0).toLocaleString()}`]),
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Employees / Teachers <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>({total})</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ExportMenu filename="employees" title="Employees Report" getData={getExportData} disabled={filtered.length === 0} />
          {can("canEditEmployees") && (
            <button onClick={() => setShowRollCall(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 13 }}>
              <CalendarCheck size={14} /> Attendance
            </button>
          )}
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
        rightSlot={
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "white" }} role="group" aria-label="View">
            {[["cards", "Card view", LayoutGrid], ["list", "List view", List]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => changeView(k)} title={label} aria-label={label} aria-pressed={view === k}
                style={{ border: "none", cursor: "pointer", padding: "8px 10px", display: "flex", alignItems: "center", background: view === k ? "var(--primary-light)" : "white", color: view === k ? "var(--primary)" : "var(--text-muted)" }}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        }
      />

      {view === "list" ? (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "11px 6px 11px 14px", width: 34 }}>
                    <HeaderCheckbox checked={bulk.pageChecked(pagedIds)} indeterminate={bulk.pageIndeterminate(pagedIds)} onChange={() => bulk.togglePage(pagedIds)} />
                  </th>
                  {["Name", "Role", "Phone", "Email", "Branch", "Salary", ""].map((h, i) => (
                    <th key={i} style={{ padding: "11px 14px", textAlign: h === "Salary" ? "right" : "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(emp => (
                  <tr key={emp.id} onClick={() => navigate(`/employees/${emp.id}`)} title="Open employee profile"
                    style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: bulk.isSelected(emp.id) ? "var(--primary-light)" : undefined }}>
                    <td style={{ padding: "9px 6px 9px 14px" }} onClick={(e) => e.stopPropagation()}>
                      <RowCheckbox checked={bulk.isSelected(emp.id)} onChange={() => bulk.toggle(emp.id)} label={`Select ${emp.name}`} />
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 14, fontWeight: 600, color: "var(--primary)", whiteSpace: "nowrap" }}>
                      {emp.name}{emp.historical === true && <HistoricalTag />}
                      {emp.recurringPayslip && <span style={{ marginLeft: 6, padding: "1px 7px", borderRadius: 20, fontSize: 10, background: "#ecfdf5", color: "#10b981", fontWeight: 600, verticalAlign: "middle" }}>Auto payslip</span>}
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{emp.role || "—"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}>{emp.phone || "—"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.email || "—"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{branches.find(b => b.id === emp.branchId)?.name || "Main Office"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#10b981", textAlign: "right", whiteSpace: "nowrap" }}>Rs. {Number(emp.salary || 0).toLocaleString()}/mo</td>
                    <td style={{ padding: "9px 14px" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button onClick={() => { setForm(emp); setEditing(emp.id); setShowModal(true); }} title="Edit" style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                        <button onClick={() => handleDeleteOne(emp)} title="Delete" style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {paged.map(emp => (
          <div key={emp.id} onClick={() => navigate(`/employees/${emp.id}`)} title="Open employee profile" style={{ background: "white", borderRadius: 12, padding: 20, cursor: "pointer", border: bulk.isSelected(emp.id) ? "1.5px solid var(--primary)" : "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <RowCheckbox checked={bulk.isSelected(emp.id)} onChange={() => bulk.toggle(emp.id)} label={`Select ${emp.name}`} />
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                  {emp.name?.charAt(0)?.toUpperCase()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setForm(emp); setEditing(emp.id); setShowModal(true); }} style={{ border: "none", background: "var(--primary-light)", color: "var(--primary)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Edit2 size={13} /></button>
                <button onClick={() => handleDeleteOne(emp)} style={{ border: "none", background: "#fef2f2", color: "var(--danger)", padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--primary)" }}>{emp.name}{emp.historical === true && <HistoricalTag />}</div>
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
      )}
      {total === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "white", borderRadius: 12, border: "1px solid var(--border)", marginTop: 8 }}>No employees found</div>}

      <Pagination
        page={safePage} pageCount={pageCount} total={total} pageSize={pageSize}
        onPage={setPage} onPageSize={setPageSize}
      />

      {showRollCall && (
        <RollCallModal
          subjectType="employee" noun="employees"
          scopeLabel={filterRole ? filterRole : "all roles in the current list"}
          people={filtered.map((e) => ({ id: e.id, name: e.name, sub: e.role, branchId: e.branchId }))}
          onClose={() => setShowRollCall(false)}
        />
      )}

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