// src/lib/storage.js
// Replaces the Firebase Storage upload used in QuickPayment.jsx.
// Uploads to a Supabase Storage bucket named "receipts" and returns
// a public URL.
//
// One-time setup in Supabase Studio → Storage:
//   - create a bucket called "receipts"
//   - mark it Public (or keep private and use signed URLs instead)

import { supabase } from "./supabaseClient";

export async function uploadReceipt(file) {
  const path = `${Date.now()}_${file.name}`;
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}
