import {
  MENU_ITEMS, DEFAULT_SECTIONS, defaultLayout, normalizeLayout, resolveMenu,
  moveItem, moveSection, removeSection, toggleHidden, addSection,
} from "./menu";

const allAccess = { can: () => true, isAdmin: true };
const flat = (layout) => layout.sections.flatMap((s) => s.items);

test("default layout places every page exactly once", () => {
  const keys = flat(defaultLayout()).sort();
  expect(keys).toEqual(Object.keys(MENU_ITEMS).sort());
});

test("normalizeLayout falls back to default for missing or invalid data", () => {
  expect(normalizeLayout(null)).toEqual(defaultLayout());
  expect(normalizeLayout({ sections: "nope" })).toEqual(defaultLayout());
});

test("normalizeLayout drops unknown/duplicate ids and re-adds missing pages", () => {
  const saved = {
    sections: [
      { id: "a", label: "Mine", items: ["students", "ghost", "students", "fees"] },
    ],
    hidden: ["ghost", "fees"],
  };
  const out = normalizeLayout(saved);
  expect(out.sections[0].items).toEqual(["students", "fees"]);
  expect(out.hidden).toEqual(["fees"]);
  // every other page still reachable
  expect(flat(out).sort()).toEqual(Object.keys(MENU_ITEMS).sort());
});

test("pages added after a layout was saved go to their default section", () => {
  const saved = defaultLayout();
  saved.sections.find((s) => s.id === "admin").items = saved.sections
    .find((s) => s.id === "admin").items.filter((k) => k !== "import");
  const out = normalizeLayout(saved);
  expect(out.sections.find((s) => s.id === "admin").items).toContain("import");
});

test("resolveMenu hides forbidden, admin-only and hidden pages, and empty sections", () => {
  const layout = toggleHidden(defaultLayout(), "trash");
  const noAdmin = { can: (p) => p === "canViewStudents", isAdmin: false };
  const menu = resolveMenu(layout, noAdmin);
  const keys = menu.flatMap((s) => s.items);
  expect(keys).toEqual(["students", "settings"]); // trash hidden, rest forbidden
  expect(menu.every((s) => s.items.length > 0)).toBe(true);
  expect(resolveMenu(defaultLayout(), allAccess).flatMap((s) => s.items)).toContain("activityLog");
});

test("moveItem reorders within and across sections without duplicating", () => {
  let l = moveItem(defaultLayout(), "employees", "people", 0);
  expect(l.sections.find((s) => s.id === "people").items).toEqual(["employees", "students"]);
  l = moveItem(l, "employees", "billing", 1);
  expect(l.sections.find((s) => s.id === "people").items).toEqual(["students"]);
  expect(l.sections.find((s) => s.id === "billing").items.slice(0, 2)).toEqual(["fees", "employees"]);
  expect(flat(l).length).toBe(Object.keys(MENU_ITEMS).length);
});

test("moveSection and removeSection keep all pages", () => {
  let l = moveSection(defaultLayout(), 0, 2);
  expect(l.sections[2].id).toBe(DEFAULT_SECTIONS[0].id);
  l = removeSection(l, "people");
  expect(l.sections.find((s) => s.id === "people")).toBeUndefined();
  expect(flat(l).sort()).toEqual(Object.keys(MENU_ITEMS).sort());
});

test("addSection appends an empty section with a unique id", () => {
  const l = addSection(addSection(defaultLayout()));
  const ids = l.sections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(l.sections.at(-1).items).toEqual([]);
});

test("edit operations don't mutate their input", () => {
  const base = defaultLayout();
  const snapshot = JSON.stringify(base);
  moveItem(base, "students", "admin", 0);
  removeSection(base, "admin");
  toggleHidden(base, "students");
  expect(JSON.stringify(base)).toBe(snapshot);
});

// ---- search, home page and prefs ----
import { searchPages, listPages, homePath, normalizePrefs } from "./menu";

test("searchPages matches label, section and keywords, best match first", () => {
  const pages = listPages(defaultLayout(), allAccess);
  expect(searchPages(pages, "").length).toBe(pages.length);
  expect(searchPages(pages, "salary").map((p) => p.key)).toEqual(["payslips"]);          // keyword
  expect(searchPages(pages, "people").map((p) => p.key)).toEqual(["students", "employees"]); // section
  expect(searchPages(pages, "pay")[0].key).toBe("payments");                              // label prefix beats keyword
  expect(searchPages(pages, "zzz")).toEqual([]);
});

test("listPages respects permissions but not the hidden list", () => {
  const layout = toggleHidden(defaultLayout(), "students");
  const only = { can: (p) => p === "canViewStudents", isAdmin: false };
  expect(listPages(layout, only).map((p) => p.key)).toEqual(["students", "trash", "settings"]);
});

test("homePath: dashboard if allowed, else the first page of the user's own menu", () => {
  expect(homePath(defaultLayout(), allAccess)).toBe("/");
  const collector = { can: (p) => p === "canViewStudents" || p === "canViewFees", isAdmin: false };
  expect(homePath(defaultLayout(), collector)).toBe("/students");
  // user moved Fees to the top -> lands there
  const moved = moveItem(defaultLayout(), "fees", "main", 0);
  expect(homePath(moved, collector)).toBe("/fees");
  // nothing accessible except Trash/Settings -> still lands on one of them
  expect(homePath(defaultLayout(), { can: () => false, isAdmin: false })).toBe("/trash");
});

test("normalizePrefs drops unknown/duplicate pins and keeps collapsed null when unset", () => {
  expect(normalizePrefs(undefined)).toEqual({ pinned: [], collapsed: null });
  expect(normalizePrefs({ pinned: ["fees", "ghost", "fees"], collapsed: ["admin"] })).toEqual({ pinned: ["fees"], collapsed: ["admin"] });
});
