import {
  LayoutDashboard, Users, UserCheck, Receipt, TrendingDown,
  Building2, Settings, BookOpen, CreditCard, FileText,
  BarChart2, Landmark, BookMarked, ShieldCheck, MessageCircle,
  Upload, Trash2, History, KeyRound,
  CalendarCheck, ClipboardList, GraduationCap, BookOpenCheck, FolderOpen, Library,
} from "lucide-react";
import { DELETE_PERMISSIONS } from "../context/routeAccess";

// Every navigable page, keyed by a stable id. `perm` is the permission
// that gates it (null = everyone); `adminOnly` pages need the admin role.
// `anyPerm` = any one of several permissions is enough.
// Ids are what gets saved in a user's custom layout, so never rename one.
export const MENU_ITEMS = {
  dashboard:       { to: "/",                  label: "Dashboard",         icon: LayoutDashboard, perm: "canViewDashboard", keywords: "home overview summary" },
  students:        { to: "/students",          label: "Students",          icon: Users,           perm: "canViewStudents", keywords: "pupils children admission" },
  employees:       { to: "/employees",         label: "Employees",         icon: UserCheck,       perm: "canViewEmployees", keywords: "staff teachers hr" },
  fees:            { to: "/fees",              label: "Fees & Invoices",   icon: Receipt,         perm: "canViewFees", keywords: "invoice billing tuition" },
  attendance:      { to: "/attendance",         label: "Attendance",        icon: CalendarCheck,   perm: "canViewAttendance", keywords: "present absent roll call register" },
  exams:           { to: "/exams",              label: "Exams & Results",   icon: ClipboardList,   perm: "canViewExams", keywords: "tests marks results grades" },
  reportCards:     { to: "/report-cards",       label: "Report Cards",      icon: GraduationCap,   perm: "canViewExams", keywords: "results transcript grades" },
  subjects:        { to: "/subjects",           label: "Subjects",          icon: Library,         perm: "canViewLearning", keywords: "courses classes curriculum" },
  homework:        { to: "/homework",           label: "Homework",          icon: BookOpenCheck,     perm: "canViewLearning", keywords: "assignments tasks" },
  materials:       { to: "/materials",          label: "Learning Materials",icon: FolderOpen,      perm: "canViewLearning", keywords: "lessons resources files notes" },
  payments:        { to: "/payments",          label: "Payments",          icon: CreditCard,      perm: "canViewPayments", keywords: "receipts income cash received" },
  expenses:        { to: "/expenses",          label: "Expenses",          icon: TrendingDown,    perm: "canViewExpenses", keywords: "spending costs bills" },
  payslips:        { to: "/payslips",          label: "Payslips",          icon: FileText,        perm: "canViewPayslips", keywords: "salary payroll wages" },
  chartOfAccounts: { to: "/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen,        perm: "canViewAccounting", keywords: "ledger accounts coa" },
  bankCash:        { to: "/bank-cash",         label: "Bank & Cash",       icon: Landmark,        perm: "canViewAccounting", keywords: "bank cash balance accounts" },
  journals:        { to: "/journals",          label: "Journals",          icon: BookMarked,      perm: "canViewAccounting", keywords: "journal entries vouchers" },
  reports:         { to: "/reports",           label: "Reports",           icon: BarChart2,       perm: "canViewReports", keywords: "statements profit loss balance sheet" },
  feeAging:        { to: "/fee-aging",         label: "Fee Aging",         icon: FileText,        perm: "canViewReports", keywords: "overdue arrears outstanding defaulters ageing" },
  collections:     { to: "/collections",       label: "Collections",       icon: Landmark,        perm: "canViewReports", keywords: "recovery collected daily recoveries" },
  reminderLogs:    { to: "/reminder-logs",     label: "Reminder Logs",     icon: MessageCircle,   perm: "canViewReports", keywords: "whatsapp reminders messages" },
  activityLog:     { to: "/activity-log",      label: "Activity Log",      icon: History,         adminOnly: true, keywords: "audit history changes" },
  branches:        { to: "/branches",          label: "Branches",          icon: Building2,       perm: "canManageBranches", keywords: "campus locations" },
  users:           { to: "/users",             label: "Users",             icon: ShieldCheck,     perm: "canManageUsers", keywords: "accounts staff logins roles" },
  access:          { to: "/access",            label: "Access Control",    icon: KeyRound,        perm: "canManageUsers", keywords: "permissions roles rights" },
  import:          { to: "/import",            label: "Import Data",       icon: Upload,          perm: "canManageUsers", keywords: "upload excel csv migrate" },
  // Trash is only useful to someone who can delete (and so restore) something.
  trash:           { to: "/trash",             label: "Trash",             icon: Trash2,          anyPerm: DELETE_PERMISSIONS, keywords: "deleted restore recycle" },
  settings:        { to: "/settings",          label: "Settings",          icon: Settings, keywords: "preferences whatsapp quick payment link" },
};

// A section with an empty label renders as plain top-level links.
export const DEFAULT_SECTIONS = [
  { id: "main",       label: "",                items: ["dashboard"] },
  { id: "people",     label: "People",          items: ["students", "employees"] },
  { id: "academics",  label: "Academics",       items: ["attendance", "exams", "reportCards", "subjects", "homework", "materials"] },
  { id: "billing",    label: "Fees & Payments", items: ["fees", "payments", "expenses", "payslips"] },
  { id: "accounting", label: "Accounting",      items: ["chartOfAccounts", "bankCash", "journals"] },
  { id: "insights",   label: "Reports & Logs",  items: ["reports", "feeAging", "collections", "reminderLogs", "activityLog"] },
  { id: "admin",      label: "Administration",  items: ["branches", "users", "access", "import"] },
  { id: "system",     label: "System",          items: ["trash", "settings"] },
];

const cloneSections = (sections) =>
  sections.map((s) => ({ id: s.id, label: s.label, items: [...s.items] }));

export const defaultLayout = () => ({ sections: cloneSections(DEFAULT_SECTIONS), hidden: [] });

// Which default section an item belongs to — used to place items that
// were added to the app after a user saved their layout.
const DEFAULT_HOME = {};
DEFAULT_SECTIONS.forEach((s) => s.items.forEach((id) => { DEFAULT_HOME[id] = s.id; }));

// Turn whatever is stored on the profile into a layout that is safe to
// render: unknown ids dropped, duplicates removed, and any page the saved
// layout doesn't know about appended to its default section.
export function normalizeLayout(saved) {
  if (!saved || !Array.isArray(saved.sections)) return defaultLayout();

  const seen = new Set();
  const sections = [];
  const usedIds = new Set();
  saved.sections.forEach((s, i) => {
    if (!s || !Array.isArray(s.items)) return;
    let id = typeof s.id === "string" && s.id && !usedIds.has(s.id) ? s.id : `sec_${i}_${sections.length}`;
    usedIds.add(id);
    const items = s.items.filter((k) => MENU_ITEMS[k] && !seen.has(k) && seen.add(k));
    sections.push({ id, label: typeof s.label === "string" ? s.label : "", items });
  });

  Object.keys(MENU_ITEMS).forEach((key) => {
    if (seen.has(key)) return;
    let home = sections.find((s) => s.id === DEFAULT_HOME[key]);
    if (!home) {
      home = sections.find((s) => s.id === "other");
      if (!home) {
        home = { id: "other", label: "More", items: [] };
        sections.push(home);
      }
    }
    home.items.push(key);
  });

  const hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((k) => MENU_ITEMS[k]) : [];
  return { sections, hidden };
}

export function isItemAllowed(key, { can, isAdmin }) {
  const item = MENU_ITEMS[key];
  if (!item) return false;
  if (item.adminOnly && !isAdmin) return false;
  if (item.anyPerm) return item.anyPerm.some((p) => can(p));
  return item.perm ? can(item.perm) : true;
}

// What the sidebar actually shows: the layout filtered by the user's
// permissions and hidden list; sections left empty are dropped.
export function resolveMenu(layout, access) {
  const hidden = new Set(layout.hidden);
  return layout.sections
    .map((s) => ({
      ...s,
      items: s.items.filter((k) => !hidden.has(k) && isItemAllowed(k, access)),
    }))
    .filter((s) => s.items.length > 0);
}

// ---- pure edit operations used by the editor (all return a new layout) ----

const copy = (layout) => ({ sections: cloneSections(layout.sections), hidden: [...layout.hidden] });

export function moveItem(layout, key, toSectionId, toIndex) {
  const next = copy(layout);
  next.sections.forEach((s) => { s.items = s.items.filter((k) => k !== key); });
  const target = next.sections.find((s) => s.id === toSectionId);
  if (!target) return layout;
  const idx = Math.max(0, Math.min(toIndex ?? target.items.length, target.items.length));
  target.items.splice(idx, 0, key);
  return next;
}

export function moveSection(layout, fromIndex, toIndex) {
  const next = copy(layout);
  if (fromIndex < 0 || fromIndex >= next.sections.length) return layout;
  const to = Math.max(0, Math.min(toIndex, next.sections.length - 1));
  const [s] = next.sections.splice(fromIndex, 1);
  next.sections.splice(to, 0, s);
  return next;
}

export function renameSection(layout, sectionId, label) {
  const next = copy(layout);
  const s = next.sections.find((x) => x.id === sectionId);
  if (s) s.label = label;
  return next;
}

export function addSection(layout, label = "New section") {
  const next = copy(layout);
  next.sections.push({ id: `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label, items: [] });
  return next;
}

// Items from a removed section move to the section above it (or the one
// below when it was first) so nothing disappears from the menu.
export function removeSection(layout, sectionId) {
  const next = copy(layout);
  const i = next.sections.findIndex((s) => s.id === sectionId);
  if (i < 0) return layout;
  const [removed] = next.sections.splice(i, 1);
  if (removed.items.length) {
    if (next.sections.length === 0) next.sections.push({ id: "other", label: "More", items: [] });
    const dest = next.sections[Math.max(0, i - 1)];
    dest.items.push(...removed.items);
  }
  return next;
}

export function toggleHidden(layout, key) {
  const next = copy(layout);
  next.hidden = next.hidden.includes(key) ? next.hidden.filter((k) => k !== key) : [...next.hidden, key];
  return next;
}

// ---- personal preferences (kept apart from the layout so toggling a
// section or pinning a page never freezes the user to a custom layout) ----

export const normalizePrefs = (saved) => ({
  pinned: Array.isArray(saved?.pinned) ? saved.pinned.filter((k, i, a) => MENU_ITEMS[k] && a.indexOf(k) === i) : [],
  collapsed: Array.isArray(saved?.collapsed) ? saved.collapsed.filter((k) => typeof k === "string") : null,
});

// ---- navigation helpers ----

// Pages the user may open, in menu order, ignoring the "hidden" list
// (a page hidden from the sidebar is still reachable by search).
export function listPages(layout, access) {
  const out = [];
  layout.sections.forEach((s) => s.items.forEach((key) => {
    if (isItemAllowed(key, access)) out.push({ key, section: s.label.trim(), ...MENU_ITEMS[key] });
  }));
  return out;
}

export function searchPages(pages, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return pages;
  return pages
    .map((p) => {
      const label = p.label.toLowerCase();
      const hay = `${label} ${p.section.toLowerCase()} ${p.keywords || ""}`;
      if (!terms.every((t) => hay.includes(t))) return null;
      // label matches outrank section/keyword matches
      return { p, score: terms.every((t) => label.includes(t)) ? (label.startsWith(terms[0]) ? 0 : 1) : 2 };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.p);
}

// Where "/" should land: the dashboard if allowed, otherwise the first
// page in the user's own menu order that the user may open. Settings and
// Trash are skipped (open to nearly everyone, so they say nothing about
// real access) and there is NO fallback to them: null = nothing usable,
// and the caller must then show the no-access screen, never guess a page.
export function homePath(layout, access) {
  if (isItemAllowed("dashboard", access)) return "/";
  const first = listPages(layout, access).find((p) => p.key !== "settings" && p.key !== "trash");
  return first ? first.to : null;
}

export const ROLE_MENU_PREFIX = "menu:";
