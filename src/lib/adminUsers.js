// src/lib/adminUsers.js
// Calls the `create-user` Supabase Edge Function to create a new
// auth user + profile row. Requires the caller to be a signed-in
// admin (the function verifies this server-side).

import { supabase } from "./supabaseClient";

export async function createUserAsAdmin({ name, email, password, role, branchId, pin }) {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { name, email, password, role, branchId, pin },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data; // { id }
}
