// supabase/functions/create-user/index.ts
//
// Creates an auth user + profile row using the service-role key.
// The browser CANNOT do this safely with the anon key, so user
// creation (old `createUserWithEmailAndPassword` in Users.jsx)
// is moved here.
//
// Deploy:   supabase functions deploy create-user
// Secrets:  supabase secrets set SERVICE_ROLE_KEY=... PROJECT_URL=...
//           (PROJECT_URL is your https://<ref>.supabase.co)
//
// The function verifies the caller is an authenticated admin before
// creating anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const PROJECT_URL = Deno.env.get("PROJECT_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!; // auto-provided

    // 1) Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(PROJECT_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ures } = await caller.auth.getUser();
    if (!ures?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2) Confirm the caller is an admin (reads their profile row).
    const admin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("users").select("role").eq("id", ures.user.id).maybeSingle();
    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 3) Validate input (SEC-14 / DB-15): never create an account with a
    //    missing or unknown role. The role must be a built-in role or the id
    //    of an existing custom role. Nobody is created as admin by omission.
    const { name, email, password, role, branchId } = await req.json();
    const BUILTIN = ["admin", "branch_manager", "accountant", "fee_collector"];
    if (!email || typeof email !== "string" || !password || typeof password !== "string" || password.length < 8) {
      return new Response(JSON.stringify({ error: "email and a password of at least 8 characters are required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!role || typeof role !== "string") {
      return new Response(JSON.stringify({ error: "role is required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!BUILTIN.includes(role)) {
      const { data: cr } = await admin.from("custom_roles").select("id").eq("id", role).maybeSingle();
      if (!cr) {
        return new Response(JSON.stringify({ error: "unknown role" }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // 4) Create the auth user, then the profile. If the profile insert
    //    fails, delete the auth user again so no profile-less login is left
    //    behind. (The PIN column is no longer written: PIN login was removed.)
    const { data: created, error: cErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (cErr) throw cErr;

    const id = created.user.id;
    const { error: pErr } = await admin.from("users").insert({
      id,
      uid: id,
      name,
      email,
      role,
      branch_id: branchId || null,
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(id);
      throw pErr;
    }

    return new Response(JSON.stringify({ id }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
