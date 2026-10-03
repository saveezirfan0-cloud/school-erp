// src/lib/adminUsers.js
// Calls the `create-user` Supabase Edge Function for admin-only user
// management: creating an auth user + profile, and deleting both.
// The function verifies server-side that the caller is a signed-in admin.

import { supabase } from "./supabaseClient";

export const MIN_PASSWORD_LENGTH = 10;

// supabase-js hides the JSON body of non-2xx replies inside error.context.
async function readBody(data, error) {
  if (data && typeof data === "object") return data;
  try {
    if (error?.context && typeof error.context.json === "function") {
      return await error.context.json();
    }
  } catch { /* body was not JSON */ }
  return null;
}

export async function createUserAsAdmin({ name, email, password, role, branchId }) {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { action: "create", name, email, password, role, branchId },
  });
  const body = await readBody(data, error);
  if (error || body?.error) {
    throw new Error(body?.error || "Could not create the user. Please try again.");
  }
  return body; // { id }
}

// Removes the sign-in account AND the profile row.
//
// Resolves { authDeleted: true } when the updated function did it all.
// Throws an Error with `.code` when the updated function refused or
// failed (show the message, do not fall back).
// Throws an Error with `.legacyFunction = true` when the function gave
// no structured reply, i.e. it has not been redeployed yet (or is
// unreachable). The caller may then fall back to deleting the profile
// row only, which leaves the login working.
export async function deleteUserAsAdmin(id) {
  const { data, error } = await supabase.functions.invoke("create-user", {
    // `email` is a deliberately invalid value: the new function ignores it
    // on delete, while an old, not-yet-redeployed function (which has no
    // delete action and would treat this as "create user") rejects it
    // instead of creating a stray account.
    body: { action: "delete", id, email: "delete-request", password: "x" },
  });
  const body = await readBody(data, error);
  if (!error && body?.deleted === true) return { authDeleted: true };

  if (body?.code) {
    const e = new Error(body.error || "Could not delete the user.");
    e.code = body.code;
    throw e;
  }
  const e = new Error("The user-management function does not support deleting accounts yet.");
  e.legacyFunction = true;
  throw e;
}
