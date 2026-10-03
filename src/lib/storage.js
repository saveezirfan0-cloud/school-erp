// src/lib/storage.js
// Receipt uploads to the Supabase Storage bucket "receipts".
//
// Client-side checks here are a convenience (fail fast, nice messages); the
// bucket's own allowed_mime_types / file_size_limit and storage policies are
// what actually enforce the rules. Object paths are generated here and never
// contain anything the user typed.
//
// Returns the public URL, as before. If the bucket is made private later,
// switch to storing the path and using createSignedUrl.

import { supabase } from "./supabaseClient";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

// MIME type -> the extension we store under. The extension comes from this
// table, never from the user's file name.
export const ALLOWED_RECEIPT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Throws a user-readable Error if the file is not an acceptable receipt. */
export function validateReceipt(file) {
  if (!file || typeof file.size !== "number") throw new Error("No file selected");
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_RECEIPT_TYPES, file.type)) {
    throw new Error("Receipt must be a JPG, PNG, WebP image or a PDF");
  }
  if (file.size <= 0) throw new Error("The selected file is empty");
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error(`Receipt is too large (max ${Math.round(MAX_RECEIPT_BYTES / 1024 / 1024)} MB)`);
  }
}

function randomId() {
  const c = typeof window !== "undefined" ? window.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure random generator unavailable");
}

/** Build the object path: `<yyyy-mm>/<random>.<ext>`. No user-controlled parts. */
export function receiptPath(file, now = new Date()) {
  const ext = ALLOWED_RECEIPT_TYPES[file.type];
  const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${folder}/${randomId()}.${ext}`;
}

export async function uploadReceipt(file) {
  validateReceipt(file);
  const path = receiptPath(file);
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;

  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}
