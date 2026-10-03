import {
  personalPresets, sharedPresets, presetList, resolveActive, upsertPersonal, removePersonal, DEFAULT_PRESET_ID,
} from "./reportPresets";
import { patchSection, defaultLayout } from "../config/reportLayout";

const layoutA = patchSection(defaultLayout(), "income:fees", { label: "School Fees" });

test("older accounts' single layout surfaces as 'My layout'", () => {
  expect(personalPresets({ hajiPresets: undefined, hajiLayout: layoutA })).toMatchObject([{ id: "my", name: "My layout" }]);
  expect(personalPresets({ hajiPresets: undefined, hajiLayout: null })).toEqual([]);
  // once presets exist, the legacy layout is ignored
  expect(personalPresets({ hajiPresets: [], hajiLayout: layoutA })).toEqual([]);
});

test("junk entries are dropped and layouts normalised", () => {
  const out = personalPresets({ hajiPresets: [{ id: "a", name: "A", layout: null }, { name: "no id" }, null] });
  expect(out).toHaveLength(1);
  expect(out[0].layout.options.language).toBe("en");
});

test("list order: built-in, shared, mine; ids are prefixed by kind", () => {
  const shared = sharedPresets([{ id: "preset:z", data: { name: "Zeta", layout: layoutA } }, { id: "preset:a", data: { name: "Alpha", layout: layoutA, isDefault: true } }, { id: "bad", data: {} }]);
  expect(shared.map((s) => s.name)).toEqual(["Alpha", "Zeta"]);
  const list = presetList([{ id: "p1", name: "Mine", layout: layoutA }], shared);
  expect(list.map((p) => p.id)).toEqual([DEFAULT_PRESET_ID, "s:preset:a", "s:preset:z", "p:p1"]);
  expect(list.map((p) => p.kind)).toEqual(["builtin", "shared", "shared", "mine"]);
});

test("active preset: the user's pick, else the shared default, else built-in", () => {
  const shared = sharedPresets([{ id: "preset:a", data: { name: "Alpha", layout: layoutA, isDefault: true } }]);
  const list = presetList([{ id: "p1", name: "Mine", layout: layoutA }], shared);
  expect(resolveActive(list, "p:p1").name).toBe("Mine");
  expect(resolveActive(list, null).name).toBe("Alpha");
  expect(resolveActive(list, "p:gone").name).toBe("Alpha");
  expect(resolveActive(presetList([], []), null).kind).toBe("builtin");
});

test("upsert adds or replaces; remove deletes", () => {
  let p = upsertPersonal([], { id: "x", name: "  First  ", layout: layoutA });
  expect(p[0].name).toBe("First");
  p = upsertPersonal(p, { id: "x", name: "Renamed", layout: layoutA });
  expect(p).toHaveLength(1);
  expect(p[0].name).toBe("Renamed");
  p = upsertPersonal(p, { name: "", layout: layoutA }); // new id, default name
  expect(p).toHaveLength(2);
  expect(p[1].name).toBe("My layout");
  expect(removePersonal(p, "x")).toHaveLength(1);
});
