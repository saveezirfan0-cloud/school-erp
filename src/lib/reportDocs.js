// src/lib/reportDocs.js
//
// Small key/value store for report data that must be shared between users:
//   kind "preset"  shared layout presets (admin writes)
//   kind "close"   frozen month-end statements (accountant/admin write)
// Backed by public.report_docs (supabase/report_docs.sql). If that table has
// not been created yet every call degrades to "not available" instead of
// throwing, so the report keeps working without it.

import { supabase } from "./supabaseClient";

const TABLE = "report_docs";

const isMissingTable = (e) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message || ""));

export async function listReportDocs(kind) {
  const { data, error } = await supabase.from(TABLE).select("id, kind, data, updated_by, updated_at").eq("kind", kind);
  if (error) {
    if (isMissingTable(error)) return { available: false, docs: [] };
    throw error;
  }
  return { available: true, docs: data || [] };
}

export async function saveReportDoc(id, kind, data, updatedBy = "") {
  const { error } = await supabase.from(TABLE).upsert({ id, kind, data, updated_by: updatedBy }, { onConflict: "id" });
  if (error) {
    if (isMissingTable(error)) throw new Error("Shared reports aren't set up yet — run supabase/report_docs.sql in the Supabase SQL editor.");
    throw error;
  }
}

export async function deleteReportDoc(id) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}
