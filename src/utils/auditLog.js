// src/utils/auditLog.js
//
// Client-side activity log writer: logActivity(action, module, details).
// Rows land in the audit_log table (anyone signed in may INSERT, only
// admins may SELECT).
//
// This is a BEST-EFFORT convenience trail, not evidence. The browser can be
// bypassed, so the authoritative trail is meant to come from database
// triggers (audit finding SEC-04). What this file guarantees:
//   - identity always comes from the live auth session (the real user id and
//     email), never from the caller. There is no way to log "as" someone else.
//   - it never throws and never blocks the real action: callers do not need
//     to await it, and a logging failure is only a console warning.
//
// The user id is stored in the row's `extra` jsonb as `userId` so this works
// with the current schema; once the audit_log table gains a user_id column
// (set by a trigger from auth.uid()), that column becomes the source of truth.

import { supabase } from "../lib/supabaseClient";
import { db, collection, addDoc, serverTimestamp } from "../firebase";

// Real identity of the signed-in user, read from the local session (no
// network round trip). Returns null when nobody is signed in.
async function currentIdentity() {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    return user ? { id: user.id, email: user.email || null } : null;
  } catch {
    return null;
  }
}

/**
 * Record one activity-log entry (fire and forget).
 * @param {string} action   short verb: "created" | "updated" | "deleted" | ...
 * @param {string} module   e.g. "Invoices", "Expenses", "Students"
 * @param {string} details  human-readable summary
 * @returns {Promise<boolean>} true if the row was written; never rejects
 */
export async function logActivity(action, module, details = "") {
  try {
    const who = await currentIdentity();
    if (!who) return false;   // not signed in: RLS would refuse anyway
    await addDoc(collection(db, "auditLog"), {
      user: who.email || who.id,
      userId: who.id,
      action: String(action ?? ""),
      module: String(module ?? ""),
      details: String(details ?? ""),
      timestamp: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.warn("Activity log not written:", e?.message || e);
    return false;
  }
}

// Back-compat with the original signature. The explicit `user` argument is
// IGNORED on purpose: identity is always taken from the auth session.
export async function logAction(_user, action, module, details = "") {
  return logActivity(action, module, details);
}
