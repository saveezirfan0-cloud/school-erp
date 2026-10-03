// supabase/functions/create-user/index.ts
//
// Admin-only user management using the service-role key. The browser
// CANNOT do this safely with the anon key, so it lives here.
//
//   POST { action: "create", name, email, password, role, branchId? }
//        -> { id }
//   POST { action: "delete", id }
//        -> { deleted: true }     (removes the sign-in account AND the profile)
//
// (A request with no `action` is treated as "create" for older clients.)
//
// Deploy:   supabase functions deploy create-user
// Secrets:  supabase secrets set SERVICE_ROLE_KEY=... PROJECT_URL=... \
//             ALLOWED_ORIGINS=https://your-app-domain,http://localhost:3000
//           PROJECT_URL is your https://<ref>.supabase.co
//           ALLOWED_ORIGINS is a comma-separated list of exact origins.
//           If it is not set the function falls back to "*" (any origin)
//           and logs a warning; calls still need an admin's bearer token.
//
// The function verifies the caller is an authenticated admin before
// doing anything. Every error reply is generic ({ error, code }); the
// details are only logged server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILTIN_ROLES = ["admin", "branch_manager", "accountant", "fee_collector"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z0-9_]{1,64}$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 72; // bcrypt limit

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
  console.warn("ALLOWED_ORIGINS is not set; allowing any origin. Set it to restrict CORS.");
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  let allow = "*";
  if (allowedOrigins.length > 0) {
    // Echo the caller's origin only if it is on the list; otherwise
    // answer with the first allowed origin, which the browser rejects.
    allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  const fail = (status: number, code: string, error: string) => reply(status, { error, code });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Method not allowed");

  try {
    const PROJECT_URL = Deno.env.get("PROJECT_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY"); // auto-provided
    if (!PROJECT_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      console.error("create-user: missing PROJECT_URL / SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
      return fail(500, "server_misconfigured", "The server is not configured correctly.");
    }

    // 1) Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(PROJECT_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ures } = await caller.auth.getUser();
    if (!ures?.user) return fail(401, "not_authenticated", "Not authenticated");

    // 2) Confirm the caller is an admin (reads their profile row).
    const admin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("users").select("role").eq("id", ures.user.id).maybeSingle();
    if (!profile || profile.role !== "admin") return fail(403, "forbidden", "Admin only");

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return fail(400, "bad_request", "Invalid request");
    }
    const action = payload.action === undefined ? "create" : payload.action;

    // ---------------------------------------------------------------
    if (action === "delete") {
      const id = typeof payload.id === "string" ? payload.id : "";
      if (!UUID_RE.test(id)) return fail(400, "invalid_id", "Invalid user id");
      if (id === ures.user.id) {
        return fail(400, "self_delete", "You cannot delete your own account.");
      }

      const { data: target } = await admin
        .from("users").select("role").eq("id", id).maybeSingle();
      if (target?.role === "admin") {
        const { count, error: cErr } = await admin
          .from("users").select("id", { count: "exact", head: true })
          .eq("role", "admin").neq("id", id);
        if (cErr) {
          console.error("create-user: admin count failed", cErr);
          return fail(500, "server_error", "Could not delete the user.");
        }
        if (!count || count < 1) {
          return fail(400, "last_admin", "You cannot delete the last admin.");
        }
      }

      const { error: dErr } = await admin.auth.admin.deleteUser(id);
      // An already-missing auth user (orphaned profile) is fine: carry on
      // and remove the profile row below.
      if (dErr && !/not.?found/i.test(String(dErr.message)) && (dErr as { status?: number }).status !== 404) {
        console.error("create-user: deleteUser failed", dErr);
        return fail(500, "server_error", "Could not delete the user.");
      }
      // The profile normally disappears via ON DELETE CASCADE; make sure.
      const { error: pErr } = await admin.from("users").delete().eq("id", id);
      if (pErr) {
        console.error("create-user: profile delete failed", pErr);
        return fail(500, "server_error", "The login was removed but the profile could not be.");
      }
      return reply(200, { deleted: true });
    }

    // ---------------------------------------------------------------
    if (action !== "create") return fail(400, "bad_request", "Unknown action");

    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const role = typeof payload.role === "string" ? payload.role.trim() : "";
    const branchId = typeof payload.branchId === "string" ? payload.branchId.trim() : "";

    if (name.length < 1 || name.length > 100) return fail(400, "invalid_name", "Enter a name (up to 100 characters).");
    if (email.length > 254 || !EMAIL_RE.test(email)) return fail(400, "invalid_email", "Enter a valid email address.");
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return fail(400, "invalid_password", `Password must be ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`);
    }
    // No role means no user: never fall through to the table default.
    if (!ROLE_RE.test(role)) return fail(400, "invalid_role", "Choose a valid role.");
    if (!BUILTIN_ROLES.includes(role)) {
      const { data: custom } = await admin
        .from("custom_roles").select("id").eq("id", role).maybeSingle();
      if (!custom) return fail(400, "invalid_role", "Choose a valid role.");
    }
    if (branchId) {
      if (!UUID_RE.test(branchId)) return fail(400, "invalid_branch", "Choose a valid branch.");
      const { data: branch } = await admin.from("branches").select("id").eq("id", branchId).maybeSingle();
      if (!branch) return fail(400, "invalid_branch", "Choose a valid branch.");
    }

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cErr || !created?.user) {
      console.error("create-user: createUser failed", cErr);
      return fail(400, "create_failed", "Could not create the user. The email may already be in use.");
    }

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
      console.error("create-user: profile insert failed", pErr);
      // Roll back so no profile-less login is left behind.
      const { error: rbErr } = await admin.auth.admin.deleteUser(id);
      if (rbErr) console.error("create-user: rollback failed", rbErr);
      return fail(400, "create_failed", "Could not create the user.");
    }

    return reply(200, { id });
  } catch (e) {
    console.error("create-user: unexpected error", e);
    return fail(500, "server_error", "Something went wrong. Please try again.");
  }
});
