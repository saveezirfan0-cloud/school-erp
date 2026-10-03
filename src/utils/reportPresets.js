// src/utils/reportPresets.js
//
// Presets are named report layouts. Three kinds:
//   builtin  "Default" — always there, read-only
//   shared   made by an admin, stored in report_docs, visible to everyone;
//            one can be the default for users who haven't picked their own
//   mine     personal, stored on the user's profile (hajiPresets)
//
// Pure helpers only; storage lives in UserContext (mine) and lib/reportDocs
// (shared).

import { defaultLayout, normalizeLayout } from "../config/reportLayout";

export const DEFAULT_PRESET_ID = "default";

const uid = () => Math.random().toString(36).slice(2, 9);

// Personal presets from the profile. Older accounts only have a single
// `hajiLayout`; surface it as "My layout" so nothing is lost.
export function personalPresets({ hajiPresets, hajiLayout }) {
  if (Array.isArray(hajiPresets)) {
    return hajiPresets.filter((p) => p?.id && p?.name).map((p) => ({ id: String(p.id), name: String(p.name), layout: normalizeLayout(p.layout) }));
  }
  if (hajiLayout) return [{ id: "my", name: "My layout", layout: normalizeLayout(hajiLayout) }];
  return [];
}

// Shared presets from report_docs rows ({ id, data: { name, layout, isDefault } }).
export function sharedPresets(docs) {
  return (docs || [])
    .filter((d) => d?.data?.name)
    .map((d) => ({ id: d.id, name: d.data.name, layout: normalizeLayout(d.data.layout), isDefault: !!d.data.isDefault }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Everything the user can pick, with a stable prefixed id.
export function presetList(personal, shared) {
  return [
    { id: DEFAULT_PRESET_ID, name: "Default", kind: "builtin", layout: defaultLayout() },
    ...shared.map((p) => ({ id: `s:${p.id}`, rawId: p.id, name: p.name, kind: "shared", layout: p.layout, isDefault: p.isDefault })),
    ...personal.map((p) => ({ id: `p:${p.id}`, rawId: p.id, name: p.name, kind: "mine", layout: p.layout })),
  ];
}

// The preset in effect: the user's pick, else the shared default, else Default.
export function resolveActive(list, activeId) {
  return list.find((p) => p.id === activeId)
    || list.find((p) => p.kind === "shared" && p.isDefault)
    || list[0];
}

export function upsertPersonal(personal, preset) {
  const id = preset.id || uid();
  const next = { id, name: String(preset.name || "My layout").trim() || "My layout", layout: normalizeLayout(preset.layout) };
  const exists = personal.some((p) => p.id === id);
  return exists ? personal.map((p) => (p.id === id ? next : p)) : [...personal, next];
}

export const removePersonal = (personal, id) => personal.filter((p) => p.id !== id);

export const newPresetId = uid;
