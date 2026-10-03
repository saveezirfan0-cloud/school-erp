// src/config/reportLayout.js
//
// Customisation of the Haji Sahab statement, kept as plain data so it can be
// saved as a preset (on the user's profile, or shared via report_docs) and
// applied with one pure function. Nothing here touches the books: a layout only
// changes how the statement is presented and which manual lines are added.
//
//   sections[key]  { label?, labelUr?, hidden?, excluded? }   key = "income:fees"
//   heads[id]      { label?, labelUr?, hidden?, group? }      id  = "expense:utilities"
//   custom         [{ key, side, label }]                     user-made sections
//   manual         [{ id, side, group, label, amount, month }]
//                    month "YYYY-MM" = that month only, "" = every month
//   budgets        { "expense:rent": 50000 }  monthly budget (or target) per section
//   share          { phones: [...], emails: [...] }  recipients for Share
//   options        on-screen / PDF switches + language
//
// "hidden"   removes the section/head from the statement and from its totals.
// "excluded" keeps a section visible but leaves it out of the totals
//            (e.g. show loans, don't count them as income).

import { INCOME_GROUPS, EXPENSE_GROUPS } from "./statementHeads";
import { builtinUrdu } from "./reportI18n";
import { monthsBetween } from "../utils/monthlyStatement";

export const DEFAULT_OPTIONS = {
  branchSplit: true, accounts: true, comparison: true, shareBars: true, outstanding: true, language: "en",
};

export const defaultLayout = () => ({
  v: 1, options: { ...DEFAULT_OPTIONS }, sections: {}, heads: {}, custom: [], manual: [], budgets: {},
  share: { phones: [], emails: [] },
});

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const strList = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

// Accepts anything stored (null, older shape, junk) and returns a safe layout.
export function normalizeLayout(raw) {
  const base = defaultLayout();
  if (!isObj(raw)) return base;
  const budgets = {};
  if (isObj(raw.budgets)) Object.entries(raw.budgets).forEach(([k, v]) => { if (Number(v) > 0) budgets[k] = Number(v); });
  const options = { ...base.options, ...(isObj(raw.options) ? raw.options : {}) };
  if (!["en", "ur", "both"].includes(options.language)) options.language = "en";
  return {
    v: 1,
    options,
    sections: isObj(raw.sections) ? raw.sections : {},
    heads: isObj(raw.heads) ? raw.heads : {},
    custom: Array.isArray(raw.custom) ? raw.custom.filter((c) => c?.key && (c.side === "income" || c.side === "expense")) : [],
    manual: Array.isArray(raw.manual)
      ? raw.manual.filter((m) => m?.id && (m.side === "income" || m.side === "expense")).map((m) => ({ ...m, amount: Number(m.amount) || 0 }))
      : [],
    budgets,
    share: isObj(raw.share) ? { phones: strList(raw.share.phones), emails: strList(raw.share.emails) } : base.share,
  };
}

export const isDefaultLayout = (layout) => JSON.stringify(normalizeLayout(layout)) === JSON.stringify(defaultLayout());

// ---- immutable edit helpers (used by the editor) ----

// Merge a patch into an override record, dropping empty values so a layout
// that has been "undone" equals the default again.
function patchRecord(record, key, patch) {
  const next = { ...(record[key] || {}), ...patch };
  Object.keys(next).forEach((k) => {
    if (next[k] === "" || next[k] === false || next[k] === undefined || next[k] === null) delete next[k];
  });
  const out = { ...record };
  if (Object.keys(next).length) out[key] = next; else delete out[key];
  return out;
}

export const patchSection = (layout, key, patch) => ({ ...layout, sections: patchRecord(layout.sections, key, patch) });
export const patchHead = (layout, id, patch) => ({ ...layout, heads: patchRecord(layout.heads, id, patch) });
export const setOption = (layout, name, value) => ({ ...layout, options: { ...layout.options, [name]: value } });

// amount <= 0 / empty clears the budget for that section.
export function setBudget(layout, key, amount) {
  const budgets = { ...layout.budgets };
  const n = Number(amount);
  if (n > 0) budgets[key] = n; else delete budgets[key];
  return { ...layout, budgets };
}

export function setShare(layout, patch) {
  return { ...layout, share: { ...layout.share, ...patch } };
}

const uid = () => Math.random().toString(36).slice(2, 9);

export function addCustomSection(layout, side, label) {
  const name = String(label || "").trim();
  if (!name) return layout;
  return { ...layout, custom: [...layout.custom, { key: `custom-${uid()}`, side, label: name }] };
}

export function removeCustomSection(layout, side, key) {
  const full = `${side}:${key}`;
  const heads = Object.fromEntries(Object.entries(layout.heads).filter(([, v]) => v.group !== key));
  const sections = Object.fromEntries(Object.entries(layout.sections).filter(([k]) => k !== full));
  const budgets = Object.fromEntries(Object.entries(layout.budgets).filter(([k]) => k !== full));
  return {
    ...layout,
    custom: layout.custom.filter((c) => !(c.side === side && c.key === key)),
    manual: layout.manual.map((m) => (m.side === side && m.group === key ? { ...m, group: "other" } : m)),
    sections,
    heads,
    budgets,
  };
}

export function addManualEntry(layout, entry) {
  const label = String(entry.label || "").trim();
  const amount = Number(entry.amount);
  if (!label || !(amount > 0)) return layout;
  return {
    ...layout,
    manual: [...layout.manual, { id: uid(), side: entry.side, group: entry.group || "other", label, amount, month: entry.month || "" }],
  };
}

export const removeManualEntry = (layout, id) => ({ ...layout, manual: layout.manual.filter((m) => m.id !== id) });

// Section definitions for one side, in display order (built-in, then custom).
export function sectionDefs(layout, side) {
  const builtIn = side === "income" ? INCOME_GROUPS : EXPENSE_GROUPS;
  return [
    ...builtIn.map((g) => ({ ...g, custom: false })),
    ...layout.custom.filter((c) => c.side === side).map((c) => ({ key: c.key, label: c.label, custom: true })),
  ];
}

// ---- apply ----

export const headId = (side, label) => `${side}:${String(label).toLowerCase()}`;

// Every head on one side of a statement as a flat list.
export function flattenHeads(side, section) {
  return section.groups.flatMap((g) => g.heads.map((h) => ({
    id: headId(side, h.label), label: h.label, amount: h.amount, branches: h.branches, items: h.items || [], group: g.key,
  })));
}

function applySide(side, section, layout, months) {
  const defs = sectionDefs(layout, side);
  const valid = new Set(defs.map((d) => d.key));

  const heads = flattenHeads(side, section);
  // A manual line for one month counts if that month is in the period; an
  // "every month" line counts once per month in the period.
  layout.manual
    .filter((m) => m.side === side && (!m.month || months.includes(m.month)))
    .forEach((m) => {
      const times = m.month ? 1 : months.length;
      const amount = m.amount * times;
      heads.push({
        id: `manual:${m.id}`, label: m.label, amount, manual: true,
        branches: [{ name: "Manual entry", amount }],
        items: [{ date: "", text: times > 1 ? `${m.label} (× ${times} months)` : m.label, source: "Manual entry", branch: "Manual entry", amount }],
        group: valid.has(m.group) ? m.group : "other",
      });
    });

  let hiddenAmount = 0;
  const shown = [];
  heads.forEach((h) => {
    const o = layout.heads[h.id] || {};
    const group = valid.has(o.group) ? o.group : h.group;
    if (o.hidden || layout.sections[`${side}:${group}`]?.hidden) { hiddenAmount += h.amount; return; }
    const renamed = !!o.label;
    shown.push({
      ...h, group, label: o.label || h.label,
      labelUr: o.labelUr || (renamed ? "" : builtinUrdu(h.label)),
    });
  });

  let total = 0;
  let excludedAmount = 0;
  let budgetTotal = 0;
  const groups = defs
    .map((def) => {
      const o = layout.sections[`${side}:${def.key}`] || {};
      const items = shown.filter((h) => h.group === def.key).sort((a, b) => b.amount - a.amount);
      const gTotal = items.reduce((s, h) => s + h.amount, 0);
      const renamed = !!o.label;
      return {
        key: def.key, label: o.label || def.label,
        labelUr: o.labelUr || (renamed ? "" : builtinUrdu(def.label)),
        total: gTotal, heads: items, excluded: !!o.excluded,
        budget: layout.budgets[`${side}:${def.key}`] || 0,
        hidden: !!o.hidden,
      };
    })
    // keep sections that have money, or a budget to report against
    .filter((g) => !g.hidden && (g.heads.length > 0 || g.budget > 0));
  groups.forEach((g) => {
    if (g.excluded) excludedAmount += g.total; else { total += g.total; budgetTotal += g.budget; }
  });

  return { groups, total, hiddenAmount, excludedAmount, budgetTotal };
}

// Returns a statement with the layout applied and all totals recomputed.
export function applyLayout(statement, layoutIn) {
  const layout = normalizeLayout(layoutIn);
  const months = monthsBetween(statement.from, statement.to);
  const income = applySide("income", statement.income, layout, months);
  const expense = applySide("expense", statement.expense, layout, months);
  return {
    ...statement,
    income,
    expense,
    totalIncome: income.total,
    totalExpense: expense.total,
    net: income.total - expense.total,
    closingBalance: statement.openingBalance + income.total - expense.total,
    options: layout.options,
  };
}
