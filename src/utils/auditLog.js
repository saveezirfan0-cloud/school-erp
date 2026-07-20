// src/utils/auditLog.js
//
// Activity log writer. Every notable action in the app calls
// logActivity(action, module, details); rows land in the audit_log
// table, which (per supabase/security.sql) anyone signed-in may
// INSERT into but only admins may SELECT — and nobody may UPDATE or
// DELETE, so the trail is immutable. The Activity Log page renders it.
//
// Logging is fire-and-forget: it never throws and callers don't need
// to await it, so a logging hiccup can never break the real action.

import { db, supabase } from "../firebase";
import { collection, addDoc, serverTimestamp } from "../firebase";

// Keep the signed-in user's email cached so logging doesn't need an
// auth round-trip per event.
let cachedEmail = null;
try {
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedEmail = session?.user?.email || null;
  });
} catch (e) {
  console.error("Activity log auth listener error", e);
}

async function resolveEmail() {
  if (cachedEmail) return cachedEmail;
  try {
    const { data } = await supabase.auth.getUser();
    cachedEmail = data?.user?.email || null;
  } catch { /* stay null */ }
  return cachedEmail;
}

/**
 * Record one activity-log entry.
 * @param {string} action   short verb: "created" | "updated" | "deleted" | "collected" | "paid" | "restored" | ...
 * @param {string} module   e.g. "Invoices", "Expenses", "Students", "Users", "Trash"
 * @param {string} details  human-readable summary, e.g. "Invoice Ali Khan — March 2026 · Rs. 5,000"
 */
export async function logActivity(action, module, details = "") {
  try {
    const email = await resolveEmail();
    await addDoc(collection(db, "auditLog"), {
      user: email || "unknown",
      action,
      module,
      details,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.error("Activity log error", e);
  }
}

// Back-compat with the original signature (explicit user object).
export async function logAction(user, action, module, details = "") {
  try {
    await addDoc(collection(db, "auditLog"), {
      user: user?.email || "unknown",
      action,
      module,
      details,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.error("Audit log error", e);
  }
}
