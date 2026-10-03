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
import { coerceColumn } from "./utils/columns";

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
  attendance: "attendance",
  // LMS / academics (supabase/lms.sql)
  subjects: "subjects",
  exams: "exams",
  examResults: "exam_results",
  assignments: "assignments",
  submissions: "submissions",
  materials: "materials",
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
  accounts: ["id", "code", "name", "type", "sub_type", "balance", "created_at", "updated_at"],
  journals: ["id", "date", "reference", "description", "debit_account", "credit_account", "amount", "notes", "created_at", "updated_at"],
  custom_roles: ["id", "permissions", "created_at", "updated_at"],
  reminder_logs: ["id", "student_id", "phone", "message", "status", "date", "timestamp", "created_at", "updated_at"],
  audit_log: ["id", "user", "action", "module", "details", "timestamp", "created_at"],
  subjects: ["id", "name", "code", "grade", "teacher", "branch_id", "created_at", "updated_at"],
  attendance: ["id", "subject_type", "subject_id", "date", "status", "branch_id", "created_at", "updated_at"],
  exams: ["id", "name", "term", "exam_type", "grade", "date", "total_marks", "published", "branch_id", "created_at", "updated_at"],
  exam_results: ["id", "exam_id", "student_id", "subject_id", "marks_obtained", "max_marks", "absent", "remarks", "branch_id", "created_at", "updated_at"],
  assignments: ["id", "title", "description", "subject_id", "grade", "assigned_date", "due_date", "max_marks", "attachment_url", "branch_id", "created_at", "updated_at"],
  submissions: ["id", "assignment_id", "student_id", "status", "submitted_date", "marks", "feedback", "attachment_url", "branch_id", "created_at", "updated_at"],
  materials: ["id", "title", "description", "kind", "url", "subject_id", "grade", "branch_id", "created_at", "updated_at"],
};

const SERVER_TS = "__SERVER_TIMESTAMP__";

// camelCase -> snake_case
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
// snake_case -> camelCase
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Convert an app object (camelCase) into a DB row for `table`.
// Known columns map directly; unknown keys go into `extra`.
//
// With `forInsert`, a serverTimestamp() aimed at created_at is left out so
// the column's `default now()` stamps it with the database clock instead of
// this browser's (possibly wrong) clock. Every table has that default.
export function encode(table, data, { forInsert = false } = {}) {
  const cols = COLUMNS[table] || [];
  const row = {};
  const extra = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === "id") continue; // id handled separately
    const snake = toSnake(k);
    if (forInsert && v === SERVER_TS && snake === "created_at") continue;
    const val = v === SERVER_TS ? new Date().toISOString() : v;
    if (cols.includes(snake)) row[snake] = coerceColumn(table, snake, val);
    else extra[k] = val;
  }
  if (Object.keys(extra).length) row.extra = extra;
  return row;
}

// Convert a DB row back into an app object (camelCase), merging
// `extra` jsonb back to the top level. Mimics { id, ...data() }.
// Real columns win over an `extra` key of the same name.
export function decode(row) {
  if (!row) return row;
  const out = {};
  if (row.extra && typeof row.extra === "object") Object.assign(out, row.extra);
  for (const [k, v] of Object.entries(row)) {
    if (k === "extra" && v && typeof v === "object") continue;
    out[toCamel(k)] = v;
  }
  return out;
}

// Tables that support soft-delete (Trash). Mirrors trash.sql.
const SOFT_DELETE_TABLES = new Set([
  "students", "employees", "invoices", "expenses", "payments",
  "payslips", "accounts", "journals", "branches", "reminder_logs",
  "subjects", "exams", "assignments", "materials",
]);

// ---- tuning knobs (exported so tests and callers can read them) ----
// PostgREST truncates every response at the project's `max-rows` setting
// (1000 by default) WITHOUT an error, so every read pages with range().
export const PAGE_SIZE = 1000;
// Hard safety cap for one read. Hitting it logs a warning and marks the
// result `truncated`; the right fix at that size is server-side aggregation.
export const MAX_FETCH_ROWS = 50000;
// Ids per PATCH/DELETE `?id=in.(...)` request, to keep URLs short.
export const ID_CHUNK = 100;

// ---- Historical data scope ----
//
// Records imported from the old Manager.io books are tagged
// `extra.historical = true`. They are hidden from every list read by default
// so current-year screens and totals (Dashboard, Reports, Bank & Cash balances,
// pending fees...) are unaffected. Turning the "History" toggle on in the
// navbar includes them everywhere.
const HISTORY_TABLES = new Set([
  "students", "employees", "invoices", "expenses", "payments", "payslips", "journals",
]);
const HISTORY_KEY = "showHistorical";

export function isHistoryVisible() {
  try { return localStorage.getItem(HISTORY_KEY) === "1"; } catch { return false; }
}

// Persist the choice and reload so every open listener re-fetches with the new scope.
export function setHistoryVisible(on) {
  try { localStorage.setItem(HISTORY_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
  window.location.reload();
}

const hiddenByHistory = (table, row) =>
  HISTORY_TABLES.has(table) && !isHistoryVisible() && row?.extra?.historical === true;

// ---- Reference objects (mirror Firestore's CollectionReference / DocumentReference) ----
class CollectionRef {
  constructor(name) {
    const table = TABLE_MAP[name];
    if (!table) throw new Error(`Unknown collection "${name}". Add it to TABLE_MAP/COLUMNS in src/firebase.js.`);
    this.name = name;                 // Firestore collection name
    this.table = table;
    this._orders = [];                // [{ col, ascending }]
    this._limit = null;
    this._where = [];                 // [{ field, op, value }]
    this._trashed = false;            // when true, read only soft-deleted rows
  }
  _clone() {
    const c = new CollectionRef(this.name);
    c._orders = this._orders.slice();
    c._limit = this._limit;
    c._where = this._where.slice();
    c._trashed = this._trashed;
    return c;
  }
}
class DocRef {
  constructor(name, id) {
    const table = TABLE_MAP[name];
    if (!table) throw new Error(`Unknown collection "${name}". Add it to TABLE_MAP/COLUMNS in src/firebase.js.`);
    this.name = name;
    this.table = table;
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

// query()/orderBy()/limit()/where(): carry intent onto a copy of the ref.
// Unsupported clauses throw instead of being silently ignored.
export function query(ref, ...clauses) {
  if (!(ref instanceof CollectionRef)) throw new Error("query() needs a collection reference");
  const q = ref._clone();   // keeps _trashed and any earlier clauses
  for (const c of clauses) {
    if (c && c.__order) q._orders.push(c.__order);
    else if (c && c.__limit !== undefined) q._limit = c.__limit;
    else if (c && c.__where) q._where.push(c.__where);
    else throw new Error("Unsupported query clause (supported: where, orderBy, limit)");
  }
  return q;
}
export function orderBy(field, direction = "asc") {
  if (direction !== "asc" && direction !== "desc") throw new Error(`orderBy direction must be "asc" or "desc"`);
  return { __order: { col: toSnake(field), ascending: direction !== "desc" } };
}
export function limit(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error("limit() needs a positive integer");
  return { __limit: n };
}
const WHERE_OPS = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in"];
export function where(field, op, value) {
  if (!WHERE_OPS.includes(op)) {
    throw new Error(`where() operator "${op}" is not supported (use ${WHERE_OPS.join(", ")})`);
  }
  if ((op === "in" || op === "not-in") && !Array.isArray(value)) {
    throw new Error(`where(..., "${op}", value) needs an array`);
  }
  return { __where: { field, op, value } };
}

// Resolve a where() field to a real column. Errors surface at fetch time,
// through the same error path as a failed request.
function columnFor(table, field) {
  const col = field === "id" ? "id" : toSnake(field);
  if (col === "id" || (COLUMNS[table] || []).includes(col)) return col;
  throw new Error(`"${field}" is not a column of ${table}; only real columns can be used in where()`);
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
// `truncated` is true when the safety cap cut the result short.
function querySnap(rows, { truncated = false } = {}) {
  const docs = (rows || []).map((r) => docSnap(r));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    truncated,
    forEach: (fn) => docs.forEach(fn),
  };
}

// ---- ordering ----
// Postgres default: NULLs sort as the largest value (last for ASC,
// first for DESC). Mirror that so client re-sorting equals server order.
export function compareValues(a, b) {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const as = String(a), bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

// Effective ordering for a ref: the caller's orderBy()s, or a stable
// default (created_at, id), always ending with `id` as tie-breaker so
// paging by range() never skips or repeats rows.
export function effectiveOrders(ref) {
  const orders = ref._orders.length ? ref._orders.slice() : [{ col: "created_at", ascending: true }];
  if (!orders.some((o) => o.col === "id")) orders.push({ col: "id", ascending: true });
  return orders;
}

export function sortRows(rows, orders) {
  return rows.slice().sort((a, b) => {
    for (const { col, ascending } of orders) {
      const c = compareValues(a[col], b[col]);
      if (c !== 0) return ascending ? c : -c;
    }
    return 0;
  });
}

// ---- where(): server translation and client-side matching ----
function applyWhere(builder, table, w) {
  const col = columnFor(table, w.field);
  switch (w.op) {
    case "==": return w.value === null ? builder.is(col, null) : builder.eq(col, w.value);
    case "!=": return w.value === null ? builder.not(col, "is", null) : builder.neq(col, w.value);
    case "<": return builder.lt(col, w.value);
    case "<=": return builder.lte(col, w.value);
    case ">": return builder.gt(col, w.value);
    case ">=": return builder.gte(col, w.value);
    case "in": return builder.in(col, w.value);
    case "not-in": return builder.not(col, "in", `(${w.value.join(",")})`);
    default: throw new Error(`Unsupported where operator ${w.op}`);
  }
}
function matchesWhere(row, table, w) {
  const v = row[columnFor(table, w.field)];
  const c = (x) => compareValues(v, x);
  switch (w.op) {
    case "==": return w.value === null ? v == null : v != null && c(w.value) === 0;
    case "!=": return w.value === null ? v != null : v == null || c(w.value) !== 0;
    // SQL comparisons with NULL are never true.
    case "<": return v != null && c(w.value) < 0;
    case "<=": return v != null && c(w.value) <= 0;
    case ">": return v != null && c(w.value) > 0;
    case ">=": return v != null && c(w.value) >= 0;
    case "in": return v != null && w.value.some((x) => c(x) === 0);
    case "not-in": return v != null && !w.value.some((x) => c(x) === 0);
    default: return false;
  }
}

// Filters + ordering for a ref (no range/limit: the pager adds that).
export function applyQuery(builder, ref) {
  // Soft-delete filtering: by default show only live rows
  // (deleted_at IS NULL); a trash view shows only deleted rows.
  if (SOFT_DELETE_TABLES.has(ref.table)) {
    if (ref._trashed) builder = builder.not("deleted_at", "is", null);
    else builder = builder.is("deleted_at", null);
  }
  for (const w of ref._where) builder = applyWhere(builder, ref.table, w);
  // Hide imported historical rows unless the History toggle is on.
  if (HISTORY_TABLES.has(ref.table) && !isHistoryVisible()) {
    builder = builder.or("extra->>historical.is.null,extra->>historical.neq.true");
  }
  for (const o of effectiveOrders(ref)) {
    builder = builder.order(o.col, { ascending: o.ascending });
  }
  return builder;
}

// ---- paged reads ----
// Fetches EVERY matching row by walking range() pages, so results are not
// silently cut at PostgREST's max-rows. Stops at the caller's limit(), at
// MAX_FETCH_ROWS (warns and reports truncated), or when rows run out.
export async function fetchAllRows(ref, { pageSize = PAGE_SIZE, maxRows = MAX_FETCH_ROWS } = {}) {
  const target = ref._limit != null ? Math.min(ref._limit, maxRows) : maxRows;
  const rows = [];
  let total = null;
  while (rows.length < target) {
    const size = Math.min(pageSize, target - rows.length);
    const from = rows.length;
    let builder = supabase.from(ref.table).select("*", { count: "exact" });
    builder = applyQuery(builder, ref).range(from, from + size - 1);
    const { data, error, count } = await builder;
    if (error) {
      // Rows vanished between pages (offset now past the end): done.
      if (error.code === "PGRST103" && rows.length > 0) break;
      throw error;
    }
    const got = data || [];
    rows.push(...got);
    if (typeof count === "number") total = count;
    if (got.length === 0) break;
    if (total !== null && rows.length >= total) break;
    // Without a count, a short page means the end (only when the server
    // honours the page size we asked for).
    if (total === null && got.length < size) break;
  }
  const wantedMore = ref._limit == null || ref._limit > maxRows;
  const capHit = wantedMore && rows.length >= maxRows && (total === null || total > rows.length);
  if (capHit) {
    console.warn(
      `[firebase shim] ${ref.table}: stopped at the ${maxRows}-row safety cap; results are truncated. ` +
      `Move this aggregation to the database.`
    );
  }
  return { rows, truncated: capHit };
}

// ---- writes ----
function noRowsError(what) {
  const e = new Error(`${what} affected no rows (not found, or you do not have permission)`);
  e.code = "NO_ROWS_AFFECTED";
  return e;
}

// Partial-failure report for chunked bulk writes.
function bulkError(cause, succeeded, failedIds) {
  const e = new Error(
    `Bulk write partly failed: ${succeeded} row(s) changed, ${failedIds.length} not. ${cause?.message || cause}`
  );
  e.cause = cause;
  e.succeeded = succeeded;
  e.failedIds = failedIds;
  return e;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// audit_log may be INSERTed by anyone signed in but only READ by admins, so
// asking PostgREST to return the inserted row would be refused for everyone
// else. Insert it without reading it back.
const WRITE_ONLY_TABLES = new Set(["audit_log"]);

export async function addDoc(ref, data) {
  const row = encode(ref.table, data, { forInsert: true });
  if (WRITE_ONLY_TABLES.has(ref.table)) {
    const { error } = await supabase.from(ref.table).insert(row);
    if (error) throw error;
    return { id: null };
  }
  const { data: inserted, error } = await supabase
    .from(ref.table)
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return { id: inserted.id };
}

// Read the current `extra` jsonb of one row (null when the row is missing).
async function readExtra(table, id) {
  const { data, error } = await supabase.from(table).select("extra").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? (data.extra || {}) : null;
}

// setDoc replaces the document, like Firestore. Pass { merge: true } to
// merge into the existing `extra` instead.
export async function setDoc(ref, data, options = {}) {
  // ref is a DocRef with an explicit id (used for users keyed by auth uid).
  const row = encode(ref.table, data, { forInsert: true });
  row.id = ref.id;
  if (options.merge && row.extra) {
    const current = await readExtra(ref.table, ref.id);
    if (current) row.extra = { ...current, ...row.extra };
  }
  const { error } = await supabase
    .from(ref.table)
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

// Partial update. Keys that live in the `extra` jsonb are MERGED into the
// stored object (read-merge-write), never overwritten wholesale. A
// concurrent writer touching the same row's extra between the read and the
// write can still lose an update; true atomic merging needs an RPC.
export async function updateDoc(ref, data) {
  const row = encode(ref.table, data);
  if (row.extra) {
    const current = await readExtra(ref.table, ref.id);
    if (current === null) throw noRowsError("updateDoc");
    row.extra = { ...current, ...row.extra };
  }
  const { data: updated, error } = await supabase
    .from(ref.table)
    .update(row)
    .eq("id", ref.id)
    .select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) throw noRowsError("updateDoc");
}

// Insert-or-update many rows in one request. `onConflict` lists the columns
// of a unique index (e.g. "subject_type,subject_id,date"); rows that hit it
// are updated instead of rejected.
//
// `onConflict` is either that snake_case comma-separated string, or an array
// of camelCase field names (e.g. ["examId","studentId","subjectId"]) which is
// converted for you. On conflict the whole row is replaced, including `extra`,
// so pass complete rows rather than partial patches.
export async function upsertDocs(name, rows, onConflict) {
  const table = TABLE_MAP[name] || name;
  if (!rows || rows.length === 0) return 0;
  const conflict = Array.isArray(onConflict) ? onConflict.map(toSnake).join(",") : onConflict;
  const { error } = await supabase.from(table).upsert(rows.map((r) => encode(table, r, { forInsert: true })), { onConflict: conflict });
  if (error) throw error;
  return rows.length;
}

export async function deleteDoc(ref) {
  // Soft-delete tables: move to Trash by stamping deleted_at.
  // Other tables (users, etc.): hard delete as before.
  if (SOFT_DELETE_TABLES.has(ref.table)) {
    const { data, error } = await supabase
      .from(ref.table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", ref.id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw noRowsError("deleteDoc");
    return;
  }
  const { data, error } = await supabase.from(ref.table).delete().eq("id", ref.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw noRowsError("deleteDoc");
}

// Restore a soft-deleted row from Trash.
export async function restoreDoc(ref) {
  const { data, error } = await supabase
    .from(ref.table)
    .update({ deleted_at: null })
    .eq("id", ref.id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw noRowsError("restoreDoc");
}

// Permanently delete a single row (used by "delete forever" in Trash).
export async function hardDeleteDoc(ref) {
  const { data, error } = await supabase.from(ref.table).delete().eq("id", ref.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw noRowsError("hardDeleteDoc");
}

// Permanently delete ALL trashed rows in a collection ("empty trash").
export async function emptyTrash(name) {
  const table = new CollectionRef(name).table;
  const { error } = await supabase.from(table).delete().not("deleted_at", "is", null);
  if (error) throw error;
}

// The Firestore API has atomic batches and transactions; Postgres through
// PostgREST has no equivalent from the browser. Faking them with sequential
// requests would give a false sense of atomicity for money, so these throw.
// Use a database function (RPC) for anything that must be all-or-nothing.
export function writeBatch() {
  throw new Error("writeBatch is not supported: writes are separate requests. Use a database RPC for atomic multi-row changes.");
}
export function runTransaction() {
  throw new Error("runTransaction is not supported. Use a database RPC for atomic multi-row changes.");
}

// ---- bulk writes (multi-select actions) ----
//
// Each runs `UPDATE/DELETE ... WHERE id IN (...)` in chunks of ID_CHUNK ids
// (so the URL stays short) and returns the number of rows REALLY affected.
// If a chunk fails after others succeeded, the thrown error carries
// `succeeded` and `failedIds` so callers can report exactly what happened.
// The realtime channel still receives one event per row, so every open
// session's cache stays in sync.
async function chunkedWrite(ids, run) {
  let succeeded = 0;
  const parts = chunk(ids, ID_CHUNK);
  for (let i = 0; i < parts.length; i++) {
    try {
      succeeded += await run(parts[i]);
    } catch (err) {
      if (i === 0) throw err;   // nothing changed yet: plain error
      throw bulkError(err, succeeded, parts.slice(i).flat());
    }
  }
  return succeeded;
}

// Run `worker(item)` over items a few at a time. Collects every failure.
async function runInChunks(items, worker, chunkSize = 5) {
  const settled = [];
  for (const part of chunk(items, chunkSize)) {
    const results = await Promise.allSettled(part.map(worker));
    results.forEach((r, i) => settled.push({ item: part[i], r }));
  }
  const failedEntries = settled.filter((s) => s.r.status === "rejected");
  return {
    succeeded: settled.length - failedEntries.length,
    failed: failedEntries.map((s) => s.item),
    firstErr: failedEntries.length ? failedEntries[0].r.reason : null,
  };
}

// Update the same fields on many rows at once.
//
// Fast path: when every field maps to a real column, chunked bulk UPDATEs.
// Merge path: if any field lives in the `extra` jsonb (e.g. an invoice's
// month/year), we must NOT bulk-write `extra`; that would overwrite each
// row's other extra keys. Instead we read each row's extra, merge the patch
// in, and update per row (read-merge-write, so a concurrent edit of the same
// row in between can be lost).
export async function updateDocs(name, ids, data) {
  const table = new CollectionRef(name).table;
  if (!ids || ids.length === 0) return 0;
  const cols = COLUMNS[table] || [];
  const direct = {};
  const extraPatch = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === "id") continue;
    const val = v === SERVER_TS ? new Date().toISOString() : v;
    const snake = toSnake(k);
    if (cols.includes(snake)) direct[snake] = coerceColumn(table, snake, val);
    else extraPatch[k] = val;
  }

  if (Object.keys(extraPatch).length === 0) {
    return chunkedWrite(ids, async (part) => {
      const { data: updated, error } = await supabase.from(table).update(direct).in("id", part).select("id");
      if (error) throw error;
      return (updated || []).length;
    });
  }

  // Merge path: read extras in chunks, then write per row.
  const rows = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data: got, error: readErr } = await supabase
      .from(table)
      .select("id, extra")
      .in("id", part);
    if (readErr) throw readErr;
    rows.push(...(got || []));
  }
  const { succeeded, failed, firstErr } = await runInChunks(rows, async (r) => {
    const merged = { ...(r.extra || {}), ...extraPatch };
    const { data: updated, error } = await supabase
      .from(table)
      .update({ ...direct, extra: merged })
      .eq("id", r.id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw noRowsError("updateDocs");
  });
  if (failed.length) throw bulkError(firstErr, succeeded, failed.map((r) => r.id));
  return succeeded;
}

// Delete many rows at once. Soft-delete tables move to Trash; other
// tables hard-delete.
export async function deleteDocs(name, ids) {
  const table = new CollectionRef(name).table;
  if (!ids || ids.length === 0) return 0;
  return chunkedWrite(ids, async (part) => {
    const q = SOFT_DELETE_TABLES.has(table)
      ? supabase.from(table).update({ deleted_at: new Date().toISOString() }).in("id", part)
      : supabase.from(table).delete().in("id", part);
    const { data: done, error } = await q.select("id");
    if (error) throw error;
    return (done || []).length;
  });
}

// Restore many trashed rows at once.
export async function restoreDocs(name, ids) {
  const table = new CollectionRef(name).table;
  if (!ids || ids.length === 0) return 0;
  return chunkedWrite(ids, async (part) => {
    const { data: done, error } = await supabase
      .from(table)
      .update({ deleted_at: null })
      .in("id", part)
      .select("id");
    if (error) throw error;
    return (done || []).length;
  });
}

// Permanently delete many rows at once (Trash "delete forever").
export async function hardDeleteDocs(name, ids) {
  const table = new CollectionRef(name).table;
  if (!ids || ids.length === 0) return 0;
  return chunkedWrite(ids, async (part) => {
    const { data: done, error } = await supabase.from(table).delete().in("id", part).select("id");
    if (error) throw error;
    return (done || []).length;
  });
}

// ---- reads ----
// The snapshot has a `truncated` flag: true only if the MAX_FETCH_ROWS
// safety cap cut the result short.
export async function getDocs(ref) {
  const { rows, truncated } = await fetchAllRows(ref);
  return querySnap(rows, { truncated });
}

// Kept for callers written against the older API (reports). getDocs() now
// pages through the whole table itself (and reports `truncated`), so this is
// the same read; rows come back in the stable (orderBy..., id) order.
export async function getAllDocs(ref) {
  return getDocs(ref);
}

export async function getDoc(ref) {
  const { data, error } = await supabase
    .from(ref.table)
    .select("*")
    .eq("id", ref.id)
    .maybeSingle();
  if (error) throw error;
  // A soft-deleted (trashed) row does not exist as far as the app is concerned.
  if (data && SOFT_DELETE_TABLES.has(ref.table) && data.deleted_at != null) return docSnap(null);
  return docSnap(data);
}

// ---- realtime (onSnapshot) ----
// Pure cache reducer for one realtime event. Returns
// { cache, changed, refetch }: `changed` means emit; `refetch` means the
// cache can no longer be trusted (e.g. a row left a limit() window).
export function applyEvent(cache, payload, ref) {
  const { eventType, new: newRow, old: oldRow } = payload || {};
  const soft = SOFT_DELETE_TABLES.has(ref.table);
  const belongs = (row) => {
    if (soft) {
      const isTrashed = row && row.deleted_at != null;
      if (ref._trashed ? !isTrashed : isTrashed) return false;
    }
    if (hiddenByHistory(ref.table, row)) return false;
    return ref._where.every((w) => matchesWhere(row, ref.table, w));
  };
  const limited = ref._limit != null;
  const has = (id) => cache.some((r) => r.id === id);
  const upsert = (row) => (has(row.id) ? cache.map((r) => (r.id === row.id ? row : r)) : [...cache, row]);

  if ((eventType === "INSERT" || eventType === "UPDATE") && newRow) {
    if (belongs(newRow)) return { cache: upsert(newRow), changed: true, refetch: false };
    if (has(newRow.id)) {
      return { cache: cache.filter((r) => r.id !== newRow.id), changed: true, refetch: limited };
    }
    return { cache, changed: false, refetch: false };
  }
  if (eventType === "DELETE") {
    const delId = oldRow ? oldRow.id : undefined;
    if (delId === undefined) return { cache, changed: false, refetch: true };
    if (!has(delId)) return { cache, changed: false, refetch: false };
    return { cache: cache.filter((r) => r.id !== delId), changed: true, refetch: limited };
  }
  return { cache, changed: false, refetch: false };
}

// Supports both signatures used in the app:
//   onSnapshot(collectionRef, cb)
//   onSnapshot(docRef, cb)            (UserContext: doc(db,"users",uid))
//   onSnapshot(ref, cb, errCb)
// Returns an idempotent unsubscribe function.
//
// For collections we keep a local cache and apply each realtime event to it
// directly, then emit immediately, so changes appear instantly in every open
// session. Guards: only the newest fetch may replace the cache; events that
// arrive while a fetch is in flight are replayed after it lands; and when
// the websocket drops and reconnects the whole collection is refetched.
export function onSnapshot(ref, onNext, onError) {
  let active = true;
  const isDoc = ref instanceof DocRef;
  const fail = (e) => {
    if (!active) return;
    if (onError) onError(e);
    else console.error("onSnapshot error:", e);
  };
  let everSubscribed = false;
  // Refetch after a successful subscribe only on RE-subscribe (reconnect).
  const onStatus = (refetch) => (status) => {
    if (status === "SUBSCRIBED") {
      if (everSubscribed) refetch();
      everSubscribed = true;
    }
  };

  // Document subscription: just refetch the single doc on any change.
  if (isDoc) {
    let docSeq = 0;
    const fetchDoc = async () => {
      const mine = ++docSeq;
      try {
        const snap = await getDoc(ref);
        if (active && mine === docSeq) onNext(snap);
      } catch (e) {
        fail(e);
      }
    };
    fetchDoc();
    const ch = supabase
      .channel(`rt_${ref.table}_${ref.id}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: ref.table, filter: `id=eq.${ref.id}` }, fetchDoc)
      .subscribe(onStatus(fetchDoc));
    return () => {
      if (!active) return;
      active = false;
      supabase.removeChannel(ch);
    };
  }

  // Collection subscription: cache + incremental apply.
  // Realtime takes a single filter (and `in` is capped at 100 values); the
  // rest is enforced client-side by applyEvent(). Note: Supabase does not
  // deliver DELETE events for a filtered subscription, so a hard delete on a
  // filtered view is picked up on the next refetch/reconnect, not instantly.
  const rtFilter = (() => {
    try {
      const w = ref._where.find((x) => (x.op === "==" && x.value !== null) || (x.op === "in" && x.value.length > 0 && x.value.length <= 100));
      if (!w) return undefined;
      const col = columnFor(ref.table, w.field);
      return w.op === "in" ? `${col}=in.(${w.value.join(",")})` : `${col}=eq.${w.value}`;
    } catch {
      return undefined; // bad field: fullFetch() reports it through onError
    }
  })();
  let cache = [];            // raw DB rows (snake_case), as returned by Supabase
  let truncated = false;
  let seq = 0;               // newest fetch id
  let inFlight = 0;          // fetches not yet settled
  let queued = [];           // events received while fetching
  const orders = effectiveOrders(ref);
  let reconcileTimer = null;

  const emit = () => {
    if (!active) return;
    let rows = sortRows(cache, orders);
    if (ref._limit != null) rows = rows.slice(0, ref._limit);
    onNext(querySnap(rows, { truncated }));
  };

  const fullFetch = async () => {
    const mine = ++seq;
    inFlight += 1;
    try {
      const res = await fetchAllRows(ref);
      inFlight -= 1;
      if (!active || mine !== seq) return;   // a newer fetch will supply the data
      cache = res.rows;
      truncated = res.truncated;
      const pending = queued;
      queued = [];
      pending.forEach((p) => { cache = applyEvent(cache, p, ref).cache; });
      emit();
    } catch (e) {
      inFlight -= 1;
      fail(e);
    }
  };

  // Debounced refetch for cases the cache cannot resolve itself.
  const scheduleReconcile = () => {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(fullFetch, 1500);
  };

  const applyOne = (payload) => {
    const r = applyEvent(cache, payload, ref);
    cache = r.cache;
    if (r.changed) emit();
    if (r.refetch) scheduleReconcile();
  };

  fullFetch();

  const channel = supabase
    .channel(`rt_${ref.table}_${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      {
        event: "*", schema: "public", table: ref.table,
        ...(rtFilter ? { filter: rtFilter } : {}),
      },
      (payload) => {
        if (!active) return;
        if (inFlight > 0) queued.push(payload);
        else applyOne(payload);
      }
    )
    .subscribe(onStatus(fullFetch));

  return () => {
    if (!active) return;
    active = false;
    queued = [];
    if (reconcileTimer) clearTimeout(reconcileTimer);
    supabase.removeChannel(channel);
  };
}

export default db;
