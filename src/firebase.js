// ============================================================
// src/firebase.js  — Firestore-compatible shim over Supabase.
//
// The app was written against the Firebase v9 modular API
// (collection / doc / addDoc / onSnapshot / ...). Rather than
// rewrite 20 page files, this module re-implements that exact
// surface on top of Supabase (Postgres + Realtime).
//
// It also keeps the old exports `db`, `auth`, `storage` so that
// `import { db } from "../firebase"` keeps working everywhere.
//
// Field naming: the React code uses camelCase (branchId,
// studentId, monthlyFee, debitAccount ...). Postgres columns are
// snake_case. We translate automatically in both directions, and
// stash any unknown keys into the `extra` jsonb column so no write
// is ever lost.
// ============================================================

import { supabase } from "./lib/supabaseClient";

export { supabase };
// `auth` / `storage` kept for import compatibility (see firebaseAuthShim usage).
export const auth = supabase.auth;
export const storage = supabase.storage;

// ---- collection name (Firestore) -> table name (Postgres) ----
const TABLE_MAP = {
  users: "users",
  branches: "branches",
  students: "students",
  employees: "employees",
  invoices: "invoices",
  expenses: "expenses",
  payments: "payments",
  payslips: "payslips",
  accounts: "accounts",
  journals: "journals",
  customRoles: "custom_roles",
  reminderLogs: "reminder_logs",
  auditLog: "audit_log",
};

// Real (non-jsonb) columns per table. Anything not in this list
// is folded into `extra`. Keep these in sync with schema.sql.
const COLUMNS = {
  users: ["id", "uid", "name", "email", "role", "branch_id", "pin", "created_at", "updated_at"],
  branches: ["id", "name", "address", "phone", "created_at", "updated_at"],
  students: ["id", "name", "student_id", "grade", "parent_name", "parent_phone", "email", "branch_id", "monthly_fee", "address", "dob", "recurring_fee", "created_at", "updated_at"],
  employees: ["id", "name", "branch_id", "created_at", "updated_at"],
  invoices: ["id", "student_id", "branch_id", "amount", "status", "due_date", "date", "paid_amount", "paid_account", "paid_date", "concession_amount", "concession_note", "created_at", "updated_at"],
  expenses: ["id", "description", "category", "amount", "date", "branch_id", "paid_account", "created_at", "updated_at"],
  payments: ["id", "type", "account", "description", "category", "amount", "date", "reference", "branch_id", "source", "source_id", "reversed", "reversal_of", "created_at", "updated_at"],
  payslips: ["id", "employee_id", "branch_id", "amount", "month", "date", "status", "paid_account", "paid_date", "created_at", "updated_at"],
  accounts: ["id", "code", "name", "type", "sub_type", "created_at", "updated_at"],
  journals: ["id", "date", "reference", "description", "debit_account", "credit_account", "amount", "notes", "created_at", "updated_at"],
  custom_roles: ["id", "permissions", "created_at", "updated_at"],
  reminder_logs: ["id", "student_id", "phone", "message", "status", "date", "timestamp", "created_at", "updated_at"],
  audit_log: ["id", "user", "action", "module", "details", "timestamp", "created_at"],
};

const SERVER_TS = "__SERVER_TIMESTAMP__";

// camelCase -> snake_case
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
// snake_case -> camelCase
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Convert an app object (camelCase) into a DB row for `table`.
// Known columns map directly; unknown keys go into `extra`.
function encode(table, data) {
  const cols = COLUMNS[table] || [];
  const row = {};
  const extra = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === "id") continue; // id handled separately
    const val = v === SERVER_TS ? new Date().toISOString() : v;
    const snake = toSnake(k);
    if (cols.includes(snake)) row[snake] = val;
    else extra[k] = val;
  }
  if (Object.keys(extra).length) row.extra = extra;
  return row;
}

// Convert a DB row back into an app object (camelCase), merging
// `extra` jsonb back to the top level. Mimics { id, ...data() }.
function decode(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "extra" && v && typeof v === "object") {
      Object.assign(out, v);
    } else {
      out[toCamel(k)] = v;
    }
  }
  return out;
}

// Tables that support soft-delete (Trash). Mirrors trash.sql.
const SOFT_DELETE_TABLES = new Set([
  "students", "employees", "invoices", "expenses", "payments",
  "payslips", "accounts", "journals", "branches", "reminder_logs",
]);

// ---- Reference objects (mirror Firestore's CollectionReference / DocumentReference) ----
class CollectionRef {
  constructor(name) {
    this.name = name;                 // Firestore collection name
    this.table = TABLE_MAP[name] || name;
    this._order = null;               // { col, ascending }
    this._limit = null;
    this._trashed = false;            // when true, read only soft-deleted rows
  }
}
class DocRef {
  constructor(name, id) {
    this.name = name;
    this.table = TABLE_MAP[name] || name;
    this.id = id;
  }
}

// ---- Public Firestore-shaped API ----
export const db = { __supabase: true };

export function collection(_db, name) {
  return new CollectionRef(name);
}

// Like collection(), but reads only the soft-deleted (trashed) rows.
// Used by the Trash view.
export function trashCollection(name) {
  const ref = new CollectionRef(name);
  ref._trashed = true;
  return ref;
}

export function doc(_db, name, id) {
  return new DocRef(name, id);
}

export function serverTimestamp() {
  return SERVER_TS;
}

// query()/orderBy()/limit(): we only need to carry intent onto the ref.
export function query(ref, ...clauses) {
  const q = new CollectionRef(ref.name);
  for (const c of clauses) {
    if (c?.__order) q._order = c.__order;
    if (c?.__limit != null) q._limit = c.__limit;
  }
  return q;
}
export function orderBy(field, direction = "asc") {
  return { __order: { col: toSnake(field), ascending: direction !== "desc" } };
}
export function limit(n) {
  return { __limit: n };
}

// ---- snapshot wrappers (shape-compatible with Firestore) ----
function docSnap(row) {
  const data = decode(row);
  return {
    id: row?.id,
    exists: () => !!row,
    data: () => {
      if (!data) return undefined;
      const { id, ...rest } = data;
      return rest;
    },
  };
}
function querySnap(rows) {
  const docs = (rows || []).map((r) => docSnap(r));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
  };
}

function applyQuery(builder, ref) {
  // Soft-delete filtering: by default show only live rows
  // (deleted_at IS NULL); a trash view shows only deleted rows.
  if (SOFT_DELETE_TABLES.has(ref.table)) {
    if (ref._trashed) builder = builder.not("deleted_at", "is", null);
    else builder = builder.is("deleted_at", null);
  }
  if (ref._order) builder = builder.order(ref._order.col, { ascending: ref._order.ascending });
  if (ref._limit != null) builder = builder.limit(ref._limit);
  return builder;
}

// ---- writes ----
export async function addDoc(ref, data) {
  const row = encode(ref.table, data);
  const { data: inserted, error } = await supabase
    .from(ref.table)
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return { id: inserted.id };
}

export async function setDoc(ref, data) {
  // ref is a DocRef with an explicit id (used for users keyed by auth uid).
  const row = encode(ref.table, data);
  row.id = ref.id;
  const { error } = await supabase
    .from(ref.table)
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function updateDoc(ref, data) {
  const row = encode(ref.table, data);
  const { error } = await supabase.from(ref.table).update(row).eq("id", ref.id);
  if (error) throw error;
}

export async function deleteDoc(ref) {
  // Soft-delete tables: move to Trash by stamping deleted_at.
  // Other tables (users, etc.): hard delete as before.
  if (SOFT_DELETE_TABLES.has(ref.table)) {
    const { error } = await supabase
      .from(ref.table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", ref.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from(ref.table).delete().eq("id", ref.id);
  if (error) throw error;
}

// Restore a soft-deleted row from Trash.
export async function restoreDoc(ref) {
  const { error } = await supabase
    .from(ref.table)
    .update({ deleted_at: null })
    .eq("id", ref.id);
  if (error) throw error;
}

// Permanently delete a single row (used by "delete forever" in Trash).
export async function hardDeleteDoc(ref) {
  const { error } = await supabase.from(ref.table).delete().eq("id", ref.id);
  if (error) throw error;
}

// Permanently delete ALL trashed rows in a collection ("empty trash").
export async function emptyTrash(name) {
  const table = TABLE_MAP[name] || name;
  const { error } = await supabase.from(table).delete().not("deleted_at", "is", null);
  if (error) throw error;
}

// ---- reads ----
export async function getDocs(ref) {
  let builder = supabase.from(ref.table).select("*");
  builder = applyQuery(builder, ref);
  const { data, error } = await builder;
  if (error) throw error;
  return querySnap(data);
}

export async function getDoc(ref) {
  const { data, error } = await supabase
    .from(ref.table)
    .select("*")
    .eq("id", ref.id)
    .maybeSingle();
  if (error) throw error;
  return docSnap(data);
}

// ---- realtime (onSnapshot) ----
// Supports both signatures used in the app:
//   onSnapshot(collectionRef, cb)
//   onSnapshot(docRef, cb)            (UserContext: doc(db,"users",uid))
//   onSnapshot(ref, cb, errCb)
// Returns an unsubscribe function.
//
// For collections we keep a local cache and apply each realtime
// event (INSERT/UPDATE/DELETE) to it directly, then emit immediately.
// This makes changes — especially deletes — appear instantly in the
// session that made them and in every other open session, without
// waiting for a full network refetch. A debounced refetch still runs
// as a safety reconciliation in case an event is ever missed.
export function onSnapshot(ref, onNext, onError) {
  let active = true;
  const isDoc = ref instanceof DocRef;

  // Document subscription: just refetch the single doc on any change.
  if (isDoc) {
    const fetchDoc = async () => {
      try {
        const snap = await getDoc(ref);
        if (active) onNext(snap);
      } catch (e) {
        if (active && onError) onError(e);
        else if (active) console.error("onSnapshot error:", e);
      }
    };
    fetchDoc();
    const ch = supabase
      .channel(`rt_${ref.table}_${ref.id}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: ref.table, filter: `id=eq.${ref.id}` }, fetchDoc)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }

  // Collection subscription: cache + incremental apply.
  let cache = [];            // raw DB rows (snake_case), as returned by Supabase
  const emit = () => {
    if (!active) return;
    // Re-sort/limit through the ref so ordering stays correct, then
    // wrap in the Firestore-shaped snapshot the app expects.
    let rows = cache.slice();
    if (ref._order) {
      const { col, ascending } = ref._order;
      rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    if (ref._limit != null) rows = rows.slice(0, ref._limit);
    onNext(querySnap(rows));
  };

  const fullFetch = async () => {
    try {
      let builder = supabase.from(ref.table).select("*");
      builder = applyQuery(builder, ref);
      const { data, error } = await builder;
      if (error) throw error;
      cache = data || [];
      emit();
    } catch (e) {
      if (active && onError) onError(e);
      else if (active) console.error("onSnapshot error:", e);
    }
  };

  // Debounced reconciliation refetch (safety net).
  let reconcileTimer = null;
  const scheduleReconcile = () => {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(fullFetch, 1500);
  };

  // Initial load.
  fullFetch();

  // Live updates applied directly to the cache.
  const channel = supabase
    .channel(`rt_${ref.table}_${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: ref.table },
      (payload) => {
        if (!active) return;
        const { eventType, new: newRow, old: oldRow } = payload;
        const idOf = (r) => (r ? r.id : undefined);

        // For soft-delete tables, a row "belongs" in this view based on
        // whether deleted_at matches what the view wants (live vs trash).
        const soft = SOFT_DELETE_TABLES.has(ref.table);
        const belongs = (row) => {
          if (!soft) return true;
          const isTrashed = row && row.deleted_at != null;
          return ref._trashed ? isTrashed : !isTrashed;
        };

        if (eventType === "INSERT" && newRow) {
          if (belongs(newRow)) {
            if (!cache.some((r) => r.id === newRow.id)) cache.push(newRow);
            else cache = cache.map((r) => (r.id === newRow.id ? newRow : r));
            emit();
          }
        } else if (eventType === "UPDATE" && newRow) {
          // A soft-delete or restore shows up as an UPDATE. Add/remove
          // from this view depending on whether it now belongs.
          if (belongs(newRow)) {
            if (cache.some((r) => r.id === newRow.id))
              cache = cache.map((r) => (r.id === newRow.id ? newRow : r));
            else cache.push(newRow);
            emit();
          } else if (cache.some((r) => r.id === newRow.id)) {
            cache = cache.filter((r) => r.id !== newRow.id);
            emit();
          }
        } else if (eventType === "DELETE") {
          const delId = idOf(oldRow);
          if (delId !== undefined) {
            cache = cache.filter((r) => r.id !== delId);
            emit();
          } else {
            // oldRow had no id (replica identity not FULL) — refetch.
            scheduleReconcile();
          }
        }
      }
    )
    .subscribe();

  return () => {
    active = false;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    supabase.removeChannel(channel);
  };
}

export default db;
