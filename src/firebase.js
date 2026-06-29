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
  invoices: ["id", "student_id", "branch_id", "amount", "status", "due_date", "date", "created_at", "updated_at"],
  expenses: ["id", "description", "category", "amount", "date", "branch_id", "created_at", "updated_at"],
  payments: ["id", "type", "account", "description", "category", "amount", "date", "reference", "branch_id", "created_at", "updated_at"],
  payslips: ["id", "employee_id", "branch_id", "amount", "month", "date", "created_at", "updated_at"],
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

// ---- Reference objects (mirror Firestore's CollectionReference / DocumentReference) ----
class CollectionRef {
  constructor(name) {
    this.name = name;                 // Firestore collection name
    this.table = TABLE_MAP[name] || name;
    this._order = null;               // { col, ascending }
    this._limit = null;
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
  const { error } = await supabase.from(ref.table).delete().eq("id", ref.id);
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
export function onSnapshot(ref, onNext, onError) {
  let active = true;

  const isDoc = ref instanceof DocRef;

  const fetchAll = async () => {
    try {
      if (isDoc) {
        const snap = await getDoc(ref);
        if (active) onNext(snap);
      } else {
        const snap = await getDocs(ref);
        if (active) onNext(snap);
      }
    } catch (e) {
      if (active && onError) onError(e);
      else if (active) console.error("onSnapshot error:", e);
    }
  };

  // Initial load.
  fetchAll();

  // Live updates: subscribe to Postgres changes on the table and
  // refetch (keeps ordering/limit/jsonb decoding consistent and simple).
  const channel = supabase
    .channel(`rt_${ref.table}_${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: ref.table },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}

export default db;
