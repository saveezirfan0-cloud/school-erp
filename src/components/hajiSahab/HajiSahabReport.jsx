import React, { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Download, SlidersHorizontal, Lock, Unlock, Layers, Eye, Filter } from "lucide-react";
import toast from "react-hot-toast";
import { matchesBranch } from "../../utils/branchFilter";
import { exportToCSV } from "../../utils/exportUtils";
import { useUser } from "../../context/UserContext";
import { useReportDocs } from "../../hooks/useReportDocs";
import { saveReportDoc, deleteReportDoc } from "../../lib/reportDocs";
import { applyLayout, isDefaultLayout, flattenHeads } from "../../config/reportLayout";
import { pick } from "../../config/reportI18n";
import {
  personalPresets, sharedPresets, presetList, resolveActive, upsertPersonal, removePersonal, newPresetId, DEFAULT_PRESET_ID,
} from "../../utils/reportPresets";
import {
  buildMonthlyStatement, statementCsvRows, monthName, fmtNum, rangeLabel, isSingleMonth, previousRange, monthRange,
} from "../../utils/monthlyStatement";
import { defaultFilters, periodRange, activeFilterCount, filterStatement, SOURCES, QUARTERS } from "../../utils/reportFilters";
import { buildYearTable, buildBranchMatrix, buildOutstanding, yearCsvRows } from "../../utils/reportViews";
import { monthlyDocument, yearDocument, printDocument } from "../../utils/reportPdf";
import { inputStyle, iconBtn, primaryBtn, card } from "./reportUi";
import MonthView from "./MonthView";
import YearView from "./YearView";
import BranchView from "./BranchView";
import DrillDownModal from "./DrillDownModal";
import ShareMenu from "./ShareMenu";
import ReportLayoutEditor from "./ReportLayoutEditor";
import PresetManager from "./PresetManager";
import HajiFilters from "./HajiFilters";
import PreviewModal from "./PreviewModal";

const VIEWS = [{ id: "month", label: "Period" }, { id: "year", label: "Year" }, { id: "branches", label: "Branches" }];

// A frozen statement keeps the numbers but not the per-record detail.
const stripItems = (st) => {
  const side = (s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, heads: g.heads.map(({ items, ...h }) => h) })) });
  return { ...st, income: side(st.income), expense: side(st.expense) };
};

// "Branches: Baneen, Banaat · Records: Expenses · …" for the PDF / preview note.
function describeFilters(f, branchChoices) {
  const parts = [];
  if (f.branches.length) parts.push(`Branches: ${branchChoices.filter((b) => f.branches.includes(b.id)).map((b) => b.name).join(", ")}`);
  if (f.sources.length && f.sources.length < SOURCES.length) parts.push(`Records: ${SOURCES.filter((s) => f.sources.includes(s.id)).map((s) => s.label).join(", ")}`);
  if (f.account) parts.push(`Paid through: ${f.account}`);
  if (f.search.trim()) parts.push(`Search: “${f.search.trim()}”`);
  if (Number(f.minAmount) > 0) parts.push(`Minimum: Rs. ${fmtNum(Number(f.minAmount))}`);
  return parts.join(" · ");
}

export default function HajiSahabReport({ raw, branches, activeBranch }) {
  const { hajiPrefs, saveHajiPrefs, can, isAdmin, userProfile } = useUser();
  const sharedDocs = useReportDocs("preset");
  const closeDocs = useReportDocs("close");
  const who = userProfile?.name || userProfile?.email || "";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [view, setView] = useState("month");
  const [filters, setFilters] = useState(defaultFilters());
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [drill, setDrill] = useState(null);
  const [showLive, setShowLive] = useState(false);

  const allBranches = activeBranch === "all";
  const scopeLabel = allBranches ? "All branches"
    : activeBranch === "main" ? "Main" : (branches.find((b) => b.id === activeBranch)?.name || "");
  const branchChoices = useMemo(
    () => (allBranches ? [{ id: "main", name: "Main" }, ...branches.map((b) => ({ id: b.id, name: b.name }))] : []),
    [allBranches, branches],
  );
  const cashAccounts = useMemo(() => raw.accounts.filter((a) => a.subType === "Bank & Cash").map((a) => a.name).filter(Boolean), [raw.accounts]);
  const filterCount = activeFilterCount(filters);
  const filtered = filterCount > 0;

  // ---- period ----
  const range = useMemo(() => periodRange(filters, year, month), [filters, year, month]);
  const singleMonth = isSingleMonth(range.from, range.to);
  const ym = range.from.slice(0, 7);
  const periodText = rangeLabel(range.from, range.to);

  // ---- presets ----
  const personal = useMemo(
    () => personalPresets({ hajiPresets: hajiPrefs.presets, hajiLayout: hajiPrefs.legacyLayout }),
    [hajiPrefs.presets, hajiPrefs.legacyLayout],
  );
  const shared = useMemo(() => sharedPresets(sharedDocs.docs), [sharedDocs.docs]);
  const list = useMemo(() => presetList(personal, shared), [personal, shared]);
  // Accounts from before presets existed only have a single saved layout; keep using it.
  const activeId = hajiPrefs.active || (!Array.isArray(hajiPrefs.presets) && hajiPrefs.legacyLayout ? "p:my" : null);
  const preset = resolveActive(list, activeId);
  const layout = preset.layout;
  const options = layout.options;
  const canUpdatePreset = preset.kind === "mine" || (preset.kind === "shared" && isAdmin && sharedDocs.available);

  const setActive = (id) => saveHajiPrefs({ presets: personal, active: id === DEFAULT_PRESET_ID ? null : id })
    .catch((e) => toast.error("Couldn't switch preset: " + (e?.message || "unknown error")));

  // ---- statements ----
  // scope = the workspace branch; withBranchFilter applies the in-report branch chips.
  const buildFor = useCallback((r, scope = activeBranch, withBranchFilter = true) => {
    const chips = withBranchFilter ? filters.branches : [];
    return buildMonthlyStatement({
      year: Number(r.from.slice(0, 4)), month: Number(r.from.slice(5, 7)), from: r.from, to: r.to, ...raw, branches,
      inScope: (rec) => matchesBranch(rec, scope) && (chips.length === 0 || chips.some((id) => matchesBranch(rec, id))),
      // Account opening balances are organisation-wide, so only add them for "All".
      includeAccountOpening: scope === "all" && chips.length === 0,
      sources: filters.sources.length ? filters.sources : null,
      account: filters.account,
    });
  }, [raw, branches, activeBranch, filters.branches, filters.sources, filters.account]);

  const { rawStatement, statement: live, previous } = useMemo(() => {
    const current = buildFor(range);
    const prior = buildFor(previousRange(range.from, range.to));
    return {
      rawStatement: current,
      statement: filterStatement(applyLayout(current, layout), filters),
      previous: filterStatement(applyLayout(prior, layout), filters),
    };
  }, [buildFor, range, layout, filters]);

  const outstanding = useMemo(() => buildOutstanding({
    ...raw, branches, to: range.to, year: Number(range.to.slice(0, 4)), month: Number(range.to.slice(5, 7)),
    inScope: (r) => matchesBranch(r, activeBranch) && (filters.branches.length === 0 || filters.branches.some((id) => matchesBranch(r, id))),
  }), [raw, branches, activeBranch, range, filters.branches]);

  const yearTable = useMemo(() => {
    if (view !== "year") return null;
    return buildYearTable(Array.from({ length: 12 }, (_, i) => {
      const r = monthRange(year, i + 1);
      return filterStatement(applyLayout(buildFor({ from: r.from, to: r.to }), layout), filters);
    }));
  }, [view, year, buildFor, layout, filters]);

  const branchMatrix = useMemo(() => {
    if (view !== "branches" || !allBranches) return null;
    const scopes = branchChoices.filter((b) => filters.branches.length === 0 || filters.branches.includes(b.id));
    return buildBranchMatrix(scopes.map((b) => ({ ...b, statement: filterStatement(applyLayout(buildFor(range, b.id, false), layout), filters) })));
  }, [view, allBranches, branchChoices, range, buildFor, layout, filters]);

  // Every head seen this year, so the editor can list heads that are quiet this period.
  const yearHeads = useMemo(() => {
    if (!editing) return [];
    const seen = new Map();
    const y = Number(range.from.slice(0, 4));
    for (let m = 1; m <= 12; m++) {
      const st = buildMonthlyStatement({ year: y, month: m, ...raw, branches, inScope: (rec) => matchesBranch(rec, activeBranch), includeAccountOpening: false });
      ["income", "expense"].forEach((side) => flattenHeads(side, st[side]).forEach((h) => { if (!seen.has(h.id)) seen.set(h.id, { ...h, side }); }));
    }
    return [...seen.values()];
  }, [editing, range.from, raw, branches, activeBranch]);

  // ---- month close (a single whole month, unfiltered) ----
  const closeId = `close:${ym}:${activeBranch}`;
  const closed = singleMonth ? closeDocs.docs.find((d) => d.id === closeId)?.data || null : null;
  const canClose = can("canEditAccounting");
  const closable = view === "month" && singleMonth && filters.mode === "month" && !filtered;
  const frozen = !!closed && !showLive && view === "month" && !filtered;
  const statement = frozen ? closed.statement : live;
  const shownPrevious = frozen ? (closed.previous || { totalIncome: 0, totalExpense: 0 }) : previous;
  const shownOutstanding = frozen ? closed.outstanding : outstanding;
  const drift = closed ? { income: rawStatement.income.total - (closed.raw?.income ?? 0), expense: rawStatement.expense.total - (closed.raw?.expense ?? 0) } : null;
  const closedInfo = frozen ? `${closed.closedBy || "—"} · ${new Date(closed.closedAt).toLocaleDateString("en-GB")}` : null;
  const lang = (statement.options || options).language || "en";
  const filterNote = describeFilters(filters, branchChoices);

  const closeMonth = async () => {
    const isOver = ym < `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const msg = `Close ${monthName(Number(ym.slice(5)))} ${ym.slice(0, 4)} (${scopeLabel})?\n\nThe statement as shown now is frozen and kept for reference.${isOver ? "" : "\n\nThis month isn't over yet."}\nRecords can still be edited elsewhere; if they change after closing you'll be warned here.`;
    if (!window.confirm(msg)) return;
    try {
      await saveReportDoc(closeId, "close", {
        ym, scope: activeBranch, scopeLabel, presetName: preset.name,
        statement: stripItems(live), previous: { totalIncome: previous.totalIncome, totalExpense: previous.totalExpense },
        outstanding, raw: { income: rawStatement.income.total, expense: rawStatement.expense.total },
        closedBy: who, closedAt: new Date().toISOString(),
      }, who);
      await closeDocs.reload();
      toast.success(`${periodText} closed`);
    } catch (e) { toast.error("Couldn't close the month: " + (e?.message || "unknown error")); }
  };
  const reopenMonth = async () => {
    if (!window.confirm("Re-open this month? The frozen statement will be deleted.")) return;
    try { await deleteReportDoc(closeId); await closeDocs.reload(); setShowLive(false); toast.success("Month re-opened"); }
    catch (e) { toast.error("Couldn't re-open: " + (e?.message || "unknown error")); }
  };

  // ---- editor / preset saving ----
  const onSaveLayout = async (draft, { mode, name, scope }) => {
    if (mode === "update") {
      if (preset.kind === "mine") {
        await saveHajiPrefs({ presets: upsertPersonal(personal, { id: preset.rawId, name: preset.name, layout: draft }), active: preset.id });
      } else if (preset.kind === "shared") {
        await saveReportDoc(preset.rawId, "preset", { name: preset.name, layout: draft, isDefault: !!preset.isDefault }, who);
        await sharedDocs.reload();
      }
      return;
    }
    if (scope === "shared") {
      const id = `preset:${newPresetId()}`;
      await saveReportDoc(id, "preset", { name, layout: draft }, who);
      await sharedDocs.reload();
      await saveHajiPrefs({ presets: personal, active: `s:${id}` });
    } else {
      const id = newPresetId();
      await saveHajiPrefs({ presets: upsertPersonal(personal, { id, name, layout: draft }), active: `p:${id}` });
    }
  };

  const onPresetAction = async ({ type, preset: p, name }) => {
    try {
      if (type === "use") await saveHajiPrefs({ presets: personal, active: p.id });
      else if (type === "rename" && p.kind === "mine") await saveHajiPrefs({ presets: upsertPersonal(personal, { id: p.rawId, name, layout: p.layout }), active: activeId });
      else if (type === "rename") { await saveReportDoc(p.rawId, "preset", { name, layout: p.layout, isDefault: !!p.isDefault }, who); await sharedDocs.reload(); }
      else if (type === "delete" && p.kind === "mine") await saveHajiPrefs({ presets: removePersonal(personal, p.rawId), active: activeId === p.id ? null : activeId });
      else if (type === "delete") {
        await deleteReportDoc(p.rawId); await sharedDocs.reload();
        if (activeId === p.id) await saveHajiPrefs({ presets: personal, active: null });
      } else if (type === "share") {
        await saveReportDoc(`preset:${newPresetId()}`, "preset", { name: p.name, layout: p.layout }, who); await sharedDocs.reload();
        toast.success("Shared with everyone");
      } else if (type === "default" || type === "undefault") {
        for (const s of shared) {
          const want = type === "default" && s.id === p.rawId;
          if (!!s.isDefault !== want) await saveReportDoc(s.id, "preset", { name: s.name, layout: s.layout, isDefault: want }, who);
        }
        await sharedDocs.reload();
      }
    } catch (e) { toast.error(e?.message || "That didn't work"); }
  };

  // Switching period mode starts from what you're looking at: the quarter that
  // holds the viewed month, or the dates in view ready to adjust.
  const onFiltersChange = (f) => {
    let next = f;
    if (f.mode !== filters.mode) {
      if (f.mode === "quarter") next = { ...f, quarter: Math.ceil(month / 3) };
      if (f.mode === "custom" && !f.from && !f.to) next = { ...f, from: range.from, to: range.to };
    }
    setFilters(next);
    setShowLive(false);
  };

  // ---- navigation ----
  const step = (delta) => {
    setShowLive(false);
    if (view === "year") { setYear((y) => y + delta); return; }
    if (filters.mode === "quarter") {
      const idx = year * 4 + (Number(filters.quarter) - 1) + delta;
      setYear(Math.floor(idx / 4));
      setFilters((f) => ({ ...f, quarter: (idx % 4) + 1 }));
      return;
    }
    const idx = year * 12 + (month - 1) + delta;
    setYear(Math.floor(idx / 12));
    setMonth((idx % 12) + 1);
  };
  const customRange = filters.mode === "custom" && view !== "year";

  // ---- export & preview ----
  const makeDoc = useCallback((ov = {}) => {
    if (view === "year" && yearTable) return yearDocument(yearTable, year, { scopeLabel, options: { ...options, ...ov } });
    return monthlyDocument({ ...statement, options: { ...(statement.options || options), ...ov } },
      { scopeLabel, outstanding: shownOutstanding, closedInfo, filterNote: frozen ? "" : filterNote });
  }, [view, yearTable, year, scopeLabel, options, statement, shownOutstanding, closedInfo, filterNote, frozen]);

  const exportPdf = () => { if (!printDocument(makeDoc())) toast.error("Pop-up blocked — use Preview, then Print / Save as PDF"); };

  const exportCsv = () => {
    if (view === "year" && yearTable) { const rows = yearCsvRows(yearTable, year); return exportToCSV(`haji-sahab-${year}`, rows[0], rows.slice(1)); }
    if (view === "branches" && branchMatrix) {
      const head = ["", ...branchMatrix.branches.map((b) => b.name), "Total"];
      const rows = [
        ...branchMatrix.income.rows.map((r) => [`Income: ${r.label}`, ...r.values, r.total]),
        ["Total income", ...branchMatrix.income.totals, branchMatrix.income.total],
        ...branchMatrix.expense.rows.map((r) => [`Expense: ${r.label}`, ...r.values, r.total]),
        ["Total expense", ...branchMatrix.expense.totals, branchMatrix.expense.total],
        ["Net", ...branchMatrix.nets, branchMatrix.netTotal],
      ];
      return exportToCSV(`haji-sahab-branches-${range.from}-${range.to}`, head, rows);
    }
    return exportToCSV(`haji-sahab-${range.from}-${range.to}`, ["Section", "Group", "Head", "Branches", "Amount"], statementCsvRows(statement));
  };

  const ledgerGap = statement.closingBalance - statement.ledgerClosing;
  const customised = !isDefaultLayout(layout);

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Period & export */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => step(-1)} disabled={customRange} style={{ ...iconBtn, opacity: customRange ? 0.4 : 1 }} title="Previous"><ChevronLeft size={16} /></button>
        {filters.mode === "month" && view !== "year" && (
          <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setShowLive(false); }} style={inputStyle} aria-label="Month">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
          </select>
        )}
        {filters.mode === "quarter" && view !== "year" && (
          <select value={filters.quarter} onChange={(e) => setFilters((f) => ({ ...f, quarter: Number(e.target.value) }))} style={inputStyle} aria-label="Quarter">
            {QUARTERS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        )}
        {!customRange && (
          <input type="number" value={year} onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setShowLive(false); }} style={{ ...inputStyle, width: 90 }} aria-label="Year" />
        )}
        <button onClick={() => step(1)} disabled={customRange} style={{ ...iconBtn, opacity: customRange ? 0.4 : 1 }} title="Next"><ChevronRight size={16} /></button>
        <span style={{ color: "var(--text-muted)", fontSize: 13, marginInlineStart: 4 }}>
          {view === "year" ? `${year}` : periodText} · {scopeLabel}
        </span>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <ShareMenu statement={statement} outstanding={shownOutstanding} scopeLabel={scopeLabel} share={layout.share} />
          <button onClick={exportCsv} style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "#475569" }}><Download size={14} /> CSV</button>
          {view !== "branches" && (
            <>
              <button onClick={() => setPreviewing(true)} style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "var(--primary)", borderColor: "var(--primary)" }} title="See the report exactly as the PDF will look"><Eye size={14} /> Preview</button>
              <button onClick={exportPdf} style={primaryBtn}><FileText size={15} /> Export PDF</button>
            </>
          )}
        </div>
      </div>

      {/* Views, filters, presets */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4, background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: 3 }}>
          {VIEWS.map((v) => {
            const disabled = v.id === "branches" && !allBranches;
            return (
              <button key={v.id} onClick={() => !disabled && setView(v.id)} disabled={disabled}
                title={disabled ? "Switch the branch selector to “All branches” to compare branches" : undefined}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: disabled ? 0.45 : 1,
                  background: view === v.id ? "var(--primary)" : "transparent", color: view === v.id ? "white" : "#475569" }}>{v.label}</button>
            );
          })}
        </div>
        <button onClick={() => setShowFilters((s) => !s)}
          style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: filtered || filters.mode !== "month" ? "var(--primary)" : "#475569", borderColor: filtered || filters.mode !== "month" ? "var(--primary)" : "var(--border)" }}>
          <Filter size={14} /> Filters{filterCount > 0 && ` (${filterCount})`}
        </button>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={preset.id} onChange={(e) => setActive(e.target.value)} aria-label="Report preset" style={{ ...inputStyle, maxWidth: 200 }}>
            {list.filter((p) => p.kind === "builtin").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {list.some((p) => p.kind === "shared") && <optgroup label="Shared">{list.filter((p) => p.kind === "shared").map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " ★" : ""}</option>)}</optgroup>}
            {list.some((p) => p.kind === "mine") && <optgroup label="Mine">{list.filter((p) => p.kind === "mine").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          </select>
          <button onClick={() => setManaging(true)} style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "#475569" }} title="Manage presets"><Layers size={14} /> Presets</button>
          <button onClick={() => setEditing(true)} title="Rename, hide or regroup sections, budgets, language, manual lines"
            style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: customised ? "var(--primary)" : "#475569", borderColor: customised ? "var(--primary)" : "var(--border)" }}>
            <SlidersHorizontal size={14} /> Customize{customised && " •"}
          </button>
          {closable && !closed && (
            <button onClick={closeMonth} disabled={!canClose || !closeDocs.available}
              title={!closeDocs.available ? "Run supabase/report_docs.sql in Supabase to enable month close" : !canClose ? "Only accountants and admins can close a month" : "Freeze this month's statement"}
              style={{ ...iconBtn, gap: 6, fontWeight: 600, fontSize: 13, color: "#475569", opacity: !canClose || !closeDocs.available ? 0.5 : 1 }}><Lock size={14} /> Close month</button>
          )}
        </div>
      </div>

      {showFilters && <HajiFilters filters={filters} onChange={onFiltersChange} branchChoices={branchChoices} cashAccounts={cashAccounts} />}

      {filtered && !showFilters && (
        <div style={{ ...card, padding: "8px 14px", marginBottom: 16, background: "#fffbeb", borderColor: "#fde68a", fontSize: 12, color: "#92400e", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}><strong>Filtered view</strong> — {filterNote}. Totals and the closing balance cover only the matching records.</span>
          <button onClick={() => setFilters(defaultFilters())} style={{ ...inputStyle, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Clear filters</button>
        </div>
      )}

      {view === "month" && closed && !filtered && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 16, background: "#ecfdf5", borderColor: "#a7f3d0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "#065f46" }}>
          <Lock size={15} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <strong>{periodText} is closed</strong> — {closed.closedBy || "—"} on {new Date(closed.closedAt).toLocaleDateString("en-GB")} ({closed.presetName}).{" "}
            {frozen ? "Showing the frozen statement." : "Showing today's live records."}
          </span>
          <button onClick={() => setShowLive((v) => !v)} style={{ ...inputStyle, cursor: "pointer", fontWeight: 600, fontSize: 12, padding: "5px 10px" }}>{frozen ? "View live" : "View frozen"}</button>
          {canClose && <button onClick={reopenMonth} style={{ ...inputStyle, cursor: "pointer", fontWeight: 600, fontSize: 12, padding: "5px 10px", display: "flex", gap: 5, alignItems: "center" }}><Unlock size={12} /> Re-open</button>}
          {(drift.income !== 0 || drift.expense !== 0) && (
            <div style={{ flexBasis: "100%", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
              Records have changed since this month was closed: income {drift.income >= 0 ? "+" : "−"}{fmtNum(Math.abs(drift.income))}, expense {drift.expense >= 0 ? "+" : "−"}{fmtNum(Math.abs(drift.expense))} (before layout). Compare with “View live”, and re-open and re-close if the new figures are right.
            </div>
          )}
        </div>
      )}

      {view === "month" && (
        <MonthView statement={statement} previous={shownPrevious} outstanding={shownOutstanding} allBranches={allBranches && filters.branches.length === 0}
          ledgerGap={ledgerGap} onDrill={frozen ? undefined : setDrill} />
      )}
      {view === "year" && yearTable && <YearView table={yearTable} year={year} options={options} />}
      {view === "branches" && branchMatrix && <BranchView matrix={branchMatrix} options={options} />}

      {drill && (
        <DrillDownModal title={pick(lang, drill.head.label, drill.head.labelUr)} subtitle={`${pick(lang, drill.group.label, drill.group.labelUr)} · ${periodText}`}
          items={drill.head.items} onClose={() => setDrill(null)} />
      )}
      {editing && (
        <ReportLayoutEditor layout={layout} heads={yearHeads} month={ym} preset={preset} canUpdate={canUpdatePreset}
          canShare={isAdmin && sharedDocs.available} onSave={onSaveLayout} onClose={() => setEditing(false)} />
      )}
      {managing && (
        <PresetManager presets={list} activeId={preset.id} isAdmin={isAdmin} sharedAvailable={sharedDocs.available}
          onAction={onPresetAction} onClose={() => setManaging(false)} />
      )}
      {previewing && <PreviewModal makeDoc={makeDoc} baseOptions={statement.options || options} landscape={view === "year"} onClose={() => setPreviewing(false)} />}
    </div>
  );
}
