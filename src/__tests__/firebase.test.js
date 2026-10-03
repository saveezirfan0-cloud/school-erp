import { supabase } from "../lib/supabaseClient";
import {
  db, collection, trashCollection, doc, query, orderBy, limit, where, serverTimestamp,
  encode, decode, applyEvent, sortRows, effectiveOrders, fetchAllRows,
  getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, restoreDoc, updateDocs, deleteDocs,
  restoreDocs, hardDeleteDocs, onSnapshot, writeBatch, runTransaction, ID_CHUNK,
} from "../firebase";
import { createMockSupabase, opsOf, hasOp, firstArgs, pagedServer, flush } from "../testUtils/mockSupabase";

jest.mock("../lib/supabaseClient", () => ({
  supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn(), auth: {} },
}));

// Install a fake backend for this test. CRA resets mocks before each test,
// so this must run inside the test (or a beforeEach), not at module level.
function useBackend(handler) {
  const mock = createMockSupabase(handler);
  supabase.from.mockImplementation(mock.from);
  supabase.channel.mockImplementation(mock.channel);
  supabase.removeChannel.mockImplementation(mock.removeChannel);
  return mock;
}

const ids = (n, prefix = "id") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("encode / decode", () => {
  test("maps camelCase to columns and folds unknown keys into extra", () => {
    const row = encode("invoices", { studentId: "s1", paidAmount: 5, month: "March", studentName: "Ali" });
    expect(row).toEqual({
      student_id: "s1",
      paid_amount: 5,
      extra: { month: "March", studentName: "Ali" },
    });
  });

  test("id is skipped and serverTimestamp becomes an ISO string", () => {
    const row = encode("payments", { id: "x", updatedAt: serverTimestamp() });
    expect(row.id).toBeUndefined();
    expect(new Date(row.updated_at).toISOString()).toBe(row.updated_at);
  });

  test("on insert, serverTimestamp for created_at is left to the database default", () => {
    expect(encode("students", { name: "A", createdAt: serverTimestamp() }, { forInsert: true }))
      .toEqual({ name: "A" });
    // ...but not on update, and not for other columns
    expect(encode("students", { createdAt: serverTimestamp() }).created_at).toBeDefined();
  });

  test("decode merges extra back and real columns win over extra keys", () => {
    const out = decode({ id: "1", student_id: "s", extra: { month: "May", studentId: "WRONG" } });
    expect(out).toEqual({ id: "1", studentId: "s", month: "May" });
  });

  test("decode of null/missing extra and null row", () => {
    expect(decode(null)).toBeNull();
    expect(decode({ id: "1", extra: null })).toEqual({ id: "1", extra: null });
  });
});

describe("query building", () => {
  test("unknown collection and unknown clause throw", () => {
    expect(() => collection(db, "nope")).toThrow(/Unknown collection/);
    expect(() => doc(db, "nope", "1")).toThrow(/Unknown collection/);
    expect(() => query(collection(db, "students"), { bogus: 1 })).toThrow(/Unsupported query clause/);
    expect(() => where("name", "array-contains", "x")).toThrow(/not supported/);
    expect(() => limit(0)).toThrow();
    expect(() => orderBy("name", "sideways")).toThrow();
  });

  test("query() keeps the trashed flag and earlier clauses", () => {
    const q = query(query(trashCollection("students"), orderBy("name")), limit(3));
    expect(q._trashed).toBe(true);
    expect(q._orders).toHaveLength(1);
    expect(q._limit).toBe(3);
  });

  test("multiple orderBy are all kept; id is always the final tie-breaker", () => {
    const q = query(collection(db, "students"), orderBy("name"), orderBy("createdAt", "desc"));
    expect(effectiveOrders(q)).toEqual([
      { col: "name", ascending: true },
      { col: "created_at", ascending: false },
      { col: "id", ascending: true },
    ]);
    expect(effectiveOrders(collection(db, "students")).map((o) => o.col)).toEqual(["created_at", "id"]);
  });

  test("getDocs hides soft-deleted rows, translates where/order and pages with range", async () => {
    const mock = useBackend(pagedServer([{ id: "a" }]));
    const q = query(
      collection(db, "invoices"),
      where("status", "==", "paid"),
      where("amount", ">=", 100),
      where("branchId", "in", ["b1", "b2"]),
      where("paidDate", "!=", null),
      orderBy("dueDate", "desc"),
    );
    const snap = await getDocs(q);
    expect(snap.size).toBe(1);
    const rec = mock.calls[0];
    expect(rec.table).toBe("invoices");
    expect(firstArgs(rec, "is")).toEqual(["deleted_at", null]);
    expect(firstArgs(rec, "eq")).toEqual(["status", "paid"]);
    expect(firstArgs(rec, "gte")).toEqual(["amount", 100]);
    expect(firstArgs(rec, "in")).toEqual(["branch_id", ["b1", "b2"]]);
    expect(opsOf(rec, "not").map(([, a]) => a)).toContainEqual(["paid_date", "is", null]);
    expect(opsOf(rec, "order").map(([, a]) => a)).toEqual([
      ["due_date", { ascending: false }],
      ["id", { ascending: true }],
    ]);
    expect(firstArgs(rec, "range")).toEqual([0, 999]);
  });

  test("trash view reads only deleted rows; non-soft tables get no deleted_at filter", async () => {
    const mock = useBackend(pagedServer([]));
    await getDocs(trashCollection("students"));
    expect(firstArgs(mock.calls[0], "not")).toEqual(["deleted_at", "is", null]);
    await getDocs(collection(db, "users"));
    expect(hasOp(mock.calls[1], "is")).toBe(false);
  });

  test("where on a non-column field rejects at fetch time", async () => {
    useBackend(pagedServer([]));
    await expect(getDocs(query(collection(db, "invoices"), where("studentName", "==", "x"))))
      .rejects.toThrow(/not a column/);
  });
});

describe("pagination (CODE-02 / DB-5 / ACC-21)", () => {
  test("walks range pages until every row is fetched (server caps at 1000)", async () => {
    const rows = ids(2500).map((id) => ({ id }));
    const mock = useBackend(pagedServer(rows, { maxRows: 1000 }));
    const snap = await getDocs(collection(db, "payments"));
    expect(snap.size).toBe(2500);
    expect(snap.truncated).toBe(false);
    expect(mock.calls.map((r) => firstArgs(r, "range"))).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(new Set(snap.docs.map((d) => d.id)).size).toBe(2500);
  });

  test("copes with a server max-rows smaller than the page size", async () => {
    const rows = ids(1200).map((id) => ({ id }));
    useBackend(pagedServer(rows, { maxRows: 500 }));
    const snap = await getDocs(collection(db, "payments"));
    expect(snap.size).toBe(1200);
  });

  test("an exact multiple of the page size does not loop or truncate", async () => {
    const rows = ids(2000).map((id) => ({ id }));
    const mock = useBackend(pagedServer(rows));
    const snap = await getDocs(collection(db, "payments"));
    expect(snap.size).toBe(2000);
    expect(mock.calls).toHaveLength(2);
  });

  test("limit() fetches only that many rows", async () => {
    const rows = ids(50).map((id) => ({ id }));
    const mock = useBackend(pagedServer(rows));
    const snap = await getDocs(query(collection(db, "payments"), limit(7)));
    expect(snap.size).toBe(7);
    expect(firstArgs(mock.calls[0], "range")).toEqual([0, 6]);
    expect(snap.truncated).toBe(false);
  });

  test("safety cap: stops, warns and flags the result as truncated", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rows = ids(100).map((id) => ({ id }));
    useBackend(pagedServer(rows));
    const res = await fetchAllRows(collection(db, "payments"), { pageSize: 10, maxRows: 25 });
    expect(res.rows).toHaveLength(25);
    expect(res.truncated).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("safety cap"));
    warn.mockRestore();
  });

  test("exactly maxRows rows is not reported as truncated", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    useBackend(pagedServer(ids(25).map((id) => ({ id }))));
    const res = await fetchAllRows(collection(db, "payments"), { pageSize: 10, maxRows: 25 });
    expect(res.rows).toHaveLength(25);
    expect(res.truncated).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("a read error is thrown, not swallowed", async () => {
    useBackend(() => ({ data: null, error: new Error("denied"), count: null }));
    await expect(getDocs(collection(db, "payments"))).rejects.toThrow("denied");
  });
});

describe("updateDoc merges extra (CODE-04)", () => {
  test("read-merge-write keeps existing extra keys", async () => {
    const mock = useBackend((rec) => {
      if (hasOp(rec, "maybeSingle")) return { data: { extra: { a: 1, b: 2 } }, error: null };
      return { data: [{ id: "u1" }], error: null };
    });
    await updateDoc(doc(db, "users", "u1"), { b: 9, c: 3, name: "New" });
    const update = mock.calls.find((r) => hasOp(r, "update"));
    expect(firstArgs(update, "update")[0]).toEqual({ name: "New", extra: { a: 1, b: 9, c: 3 } });
    expect(firstArgs(update, "eq")).toEqual(["id", "u1"]);
  });

  test("a null extra column is treated as empty", async () => {
    const mock = useBackend((rec) =>
      hasOp(rec, "maybeSingle") ? { data: { extra: null }, error: null } : { data: [{ id: "u1" }], error: null });
    await updateDoc(doc(db, "users", "u1"), { pagePermissions: { x: true } });
    expect(firstArgs(mock.calls.find((r) => hasOp(r, "update")), "update")[0])
      .toEqual({ extra: { pagePermissions: { x: true } } });
  });

  test("column-only patch needs no read", async () => {
    const mock = useBackend(() => ({ data: [{ id: "i1" }], error: null }));
    await updateDoc(doc(db, "invoices", "i1"), { status: "paid" });
    expect(mock.calls).toHaveLength(1);
    expect(hasOp(mock.calls[0], "maybeSingle")).toBe(false);
  });

  test("row missing or not permitted is an error, not silent success (CODE-03)", async () => {
    useBackend(() => ({ data: [], error: null }));
    await expect(updateDoc(doc(db, "invoices", "i1"), { status: "paid" })).rejects.toMatchObject({ code: "NO_ROWS_AFFECTED" });
    useBackend((rec) => (hasOp(rec, "maybeSingle") ? { data: null, error: null } : { data: [], error: null }));
    await expect(updateDoc(doc(db, "users", "gone"), { foo: 1 })).rejects.toMatchObject({ code: "NO_ROWS_AFFECTED" });
  });

  test("setDoc with merge merges extra; without merge it replaces", async () => {
    let upserted;
    useBackend((rec) => {
      if (hasOp(rec, "maybeSingle")) return { data: { extra: { keep: 1 } }, error: null };
      upserted = firstArgs(rec, "upsert")[0];
      return { data: null, error: null };
    });
    await setDoc(doc(db, "users", "u1"), { name: "N", more: 2 }, { merge: true });
    expect(upserted).toEqual({ name: "N", id: "u1", extra: { keep: 1, more: 2 } });
    await setDoc(doc(db, "users", "u1"), { name: "N", more: 2 });
    expect(upserted.extra).toEqual({ more: 2 });
  });
});

describe("single-row writes", () => {
  test("deleteDoc soft-deletes soft tables and hard-deletes others", async () => {
    const mock = useBackend(() => ({ data: [{ id: "x" }], error: null }));
    await deleteDoc(doc(db, "invoices", "x"));
    expect(firstArgs(mock.calls[0], "update")[0].deleted_at).toEqual(expect.any(String));
    await deleteDoc(doc(db, "users", "x"));
    expect(hasOp(mock.calls[1], "delete")).toBe(true);
  });

  test("deleteDoc / restoreDoc on zero rows throw", async () => {
    useBackend(() => ({ data: [], error: null }));
    await expect(deleteDoc(doc(db, "invoices", "x"))).rejects.toMatchObject({ code: "NO_ROWS_AFFECTED" });
    await expect(restoreDoc(doc(db, "invoices", "x"))).rejects.toMatchObject({ code: "NO_ROWS_AFFECTED" });
  });

  test("addDoc inserts and returns the id; audit_log is insert-only (no read-back)", async () => {
    const mock = useBackend((rec) =>
      hasOp(rec, "single") ? { data: { id: "new1" }, error: null } : { data: null, error: null });
    expect(await addDoc(collection(db, "students"), { name: "A", createdAt: serverTimestamp() })).toEqual({ id: "new1" });
    expect(firstArgs(mock.calls[0], "insert")[0]).toEqual({ name: "A" });
    await addDoc(collection(db, "auditLog"), { action: "x" });
    expect(hasOp(mock.calls[1], "select")).toBe(false);
  });

  test("getDoc treats a trashed row as missing", async () => {
    useBackend(() => ({ data: { id: "s1", name: "A", deleted_at: "2026-01-01" }, error: null }));
    expect((await getDoc(doc(db, "students", "s1"))).exists()).toBe(false);
    useBackend(() => ({ data: { id: "s1", name: "A", deleted_at: null }, error: null }));
    const snap = await getDoc(doc(db, "students", "s1"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()).toMatchObject({ name: "A" });
  });
});

describe("bulk writes", () => {
  test("empty id list makes no request", async () => {
    const mock = useBackend(() => ({ data: [], error: null }));
    expect(await updateDocs("invoices", [], { status: "x" })).toBe(0);
    expect(await deleteDocs("invoices", [])).toBe(0);
    expect(await restoreDocs("invoices", [])).toBe(0);
    expect(await hardDeleteDocs("invoices", [])).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });

  test("column-only updateDocs is chunked and returns the rows really changed", async () => {
    const mock = useBackend((rec) => {
      const part = firstArgs(rec, "in")[1];
      return { data: part.slice(0, part.length - 1).map((id) => ({ id })), error: null }; // one row skipped per chunk
    });
    const n = await updateDocs("invoices", ids(250), { status: "paid" });
    expect(mock.calls.map((r) => firstArgs(r, "in")[1].length)).toEqual([ID_CHUNK, ID_CHUNK, 50]);
    expect(n).toBe(99 + 99 + 49);
  });

  test("a failing later chunk reports what was already applied", async () => {
    let call = 0;
    useBackend((rec) => {
      call += 1;
      const part = firstArgs(rec, "in")[1];
      if (call === 2) return { data: null, error: new Error("boom") };
      return { data: part.map((id) => ({ id })), error: null };
    });
    const err = await deleteDocs("invoices", ids(250)).catch((e) => e);
    expect(err.succeeded).toBe(100);
    expect(err.failedIds).toHaveLength(150);
    expect(err.message).toMatch(/partly failed/);
  });

  test("a failure on the first chunk is the plain error", async () => {
    useBackend(() => ({ data: null, error: new Error("denied") }));
    await expect(deleteDocs("invoices", ids(5))).rejects.toThrow("denied");
  });

  test("extra fields use per-row read-merge so other extra keys survive", async () => {
    const writes = [];
    useBackend((rec) => {
      if (hasOp(rec, "in") && !hasOp(rec, "update")) {
        return { data: firstArgs(rec, "in")[1].map((id) => ({ id, extra: { studentName: id, month: "old" } })), error: null };
      }
      writes.push({ id: firstArgs(rec, "eq")[1], patch: firstArgs(rec, "update")[0] });
      return { data: [{ id: "x" }], error: null };
    });
    const n = await updateDocs("invoices", ["a", "b"], { month: "May", status: "paid" });
    expect(n).toBe(2);
    expect(writes).toHaveLength(2);
    expect(writes[0].patch).toEqual({ status: "paid", extra: { studentName: "a", month: "May" } });
  });

  test("merge path reports rows that could not be updated", async () => {
    useBackend((rec) => {
      if (hasOp(rec, "in") && !hasOp(rec, "update")) return { data: [{ id: "a", extra: {} }, { id: "b", extra: {} }], error: null };
      return { data: firstArgs(rec, "eq")[1] === "a" ? [{ id: "a" }] : [], error: null };
    });
    const err = await updateDocs("invoices", ["a", "b"], { month: "May" }).catch((e) => e);
    expect(err.succeeded).toBe(1);
    expect(err.failedIds).toEqual(["b"]);
  });

  test("soft vs hard bulk delete and restore", async () => {
    const mock = useBackend((rec) => ({ data: firstArgs(rec, "in")[1].map((id) => ({ id })), error: null }));
    expect(await deleteDocs("students", ["a", "b"])).toBe(2);
    expect(firstArgs(mock.calls[0], "update")[0].deleted_at).toEqual(expect.any(String));
    expect(await deleteDocs("users", ["a"])).toBe(1);
    expect(hasOp(mock.calls[1], "delete")).toBe(true);
    expect(await restoreDocs("students", ["a"])).toBe(1);
    expect(firstArgs(mock.calls[2], "update")[0]).toEqual({ deleted_at: null });
  });

  test("writeBatch and runTransaction refuse rather than fake atomicity", () => {
    expect(() => writeBatch(db)).toThrow(/not supported/);
    expect(() => runTransaction(db, () => {})).toThrow(/not supported/);
  });
});

describe("sortRows / applyEvent", () => {
  const asc = [{ col: "n", ascending: true }, { col: "id", ascending: true }];
  const desc = [{ col: "n", ascending: false }, { col: "id", ascending: true }];

  test("nulls sort last ascending and first descending, like Postgres", () => {
    const rows = [{ id: "1", n: null }, { id: "2", n: 5 }, { id: "3", n: 10 }];
    expect(sortRows(rows, asc).map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(sortRows(rows, desc).map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  test("numbers compare numerically, text lexically, ties fall back to id", () => {
    expect(sortRows([{ id: "a", n: 10 }, { id: "b", n: 9 }], asc).map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortRows([{ id: "b", n: "x" }, { id: "a", n: "x" }], asc).map((r) => r.id)).toEqual(["a", "b"]);
  });

  const live = collection(db, "invoices");
  const trash = trashCollection("invoices");
  const ev = (eventType, row, old) => ({ eventType, new: row, old });

  test("INSERT adds once; a duplicate INSERT replaces", () => {
    let r = applyEvent([], ev("INSERT", { id: "1", v: 1, deleted_at: null }), live);
    expect(r.cache).toHaveLength(1);
    r = applyEvent(r.cache, ev("INSERT", { id: "1", v: 2, deleted_at: null }), live);
    expect(r.cache).toEqual([{ id: "1", v: 2, deleted_at: null }]);
  });

  test("UPDATE replaces; soft-delete moves a row from the live view to the trash view", () => {
    const row = { id: "1", deleted_at: null };
    const trashed = { id: "1", deleted_at: "2026-01-01" };
    const l = applyEvent([row], ev("UPDATE", trashed), live);
    expect(l.cache).toEqual([]);
    expect(l.changed).toBe(true);
    const t = applyEvent([], ev("UPDATE", trashed), trash);
    expect(t.cache).toEqual([trashed]);
    // restore reverses it
    expect(applyEvent([trashed], ev("UPDATE", row), trash).cache).toEqual([]);
    expect(applyEvent([], ev("UPDATE", row), live).cache).toEqual([row]);
  });

  test("an event for a row this view does not hold is ignored", () => {
    const r = applyEvent([], ev("UPDATE", { id: "9", deleted_at: "x" }), live);
    expect(r.changed).toBe(false);
  });

  test("DELETE with and without an old id", () => {
    expect(applyEvent([{ id: "1" }, { id: "2" }], ev("DELETE", null, { id: "1" }), live).cache).toEqual([{ id: "2" }]);
    const r = applyEvent([{ id: "1" }], ev("DELETE", null, {}), live);
    expect(r.refetch).toBe(true);
    expect(r.changed).toBe(false);
  });

  test("with limit(), removing a row asks for a refetch to refill the window", () => {
    const limited = query(collection(db, "invoices"), limit(2));
    const r = applyEvent([{ id: "1" }, { id: "2" }], ev("DELETE", null, { id: "1" }), limited);
    expect(r.refetch).toBe(true);
  });

  test("where() filters realtime rows the same way as the server", () => {
    const q = query(collection(db, "invoices"), where("status", "==", "paid"), where("amount", ">", 10));
    const row = (status, amount) => ({ id: "1", status, amount, deleted_at: null });
    expect(applyEvent([], ev("INSERT", row("paid", 20)), q).cache).toHaveLength(1);
    expect(applyEvent([], ev("INSERT", row("pending", 20)), q).cache).toHaveLength(0);
    expect(applyEvent([], ev("INSERT", row("paid", null)), q).cache).toHaveLength(0);
    // a row that stops matching leaves the view
    expect(applyEvent([row("paid", 20)], ev("UPDATE", row("pending", 20)), q).cache).toHaveLength(0);
  });
});

describe("onSnapshot", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };

  test("emits the fetched rows sorted, then applies live events", async () => {
    const mock = useBackend(pagedServer([{ id: "b", name: "B" }, { id: "a", name: "A" }]));
    const seen = [];
    const unsub = onSnapshot(query(collection(db, "employees"), orderBy("name")), (snap) => seen.push(snap.docs.map((d) => d.id)));
    await flush();
    expect(seen.at(-1)).toEqual(["a", "b"]);
    mock.channels[0].handlers[0]({ eventType: "INSERT", new: { id: "0", name: "AA", deleted_at: null } });
    expect(seen.at(-1)).toEqual(["a", "0", "b"]);   // "AA" sorts between "A" and "B"
    unsub();
  });

  test("events that arrive during the initial fetch are not lost", async () => {
    const gate = deferred();
    const mock = useBackend(async () => { await gate.promise; return { data: [{ id: "1", deleted_at: null }], error: null, count: 1 }; });
    const seen = [];
    onSnapshot(collection(db, "employees"), (snap) => seen.push(snap.docs.map((d) => d.id)));
    mock.channels[0].handlers[0]({ eventType: "INSERT", new: { id: "2", deleted_at: null } });
    expect(seen).toHaveLength(0);
    gate.resolve();
    await flush();
    expect(seen.at(-1).sort()).toEqual(["1", "2"]);
  });

  test("a stale fetch cannot overwrite a newer one", async () => {
    const gates = [deferred(), deferred()];
    let n = 0;
    const mock = useBackend(async () => {
      const i = n++;
      await gates[i].promise;
      return { data: [{ id: i === 0 ? "old" : "new", deleted_at: null }], error: null, count: 1 };
    });
    const seen = [];
    onSnapshot(collection(db, "employees"), (snap) => seen.push(snap.docs.map((d) => d.id)));
    mock.channels[0].statusCb("SUBSCRIBED");        // first subscribe: no refetch
    mock.channels[0].statusCb("SUBSCRIBED");        // reconnect: refetch (second request)
    gates[1].resolve();
    await flush();
    gates[0].resolve();                              // the older request finishes last
    await flush();
    expect(seen).toEqual([["new"]]);
  });

  test("reconnect refetches; the first subscribe does not", async () => {
    const mock = useBackend(pagedServer([]));
    onSnapshot(collection(db, "employees"), () => {});
    await flush();
    expect(mock.calls).toHaveLength(1);
    mock.channels[0].statusCb("SUBSCRIBED");
    await flush();
    expect(mock.calls).toHaveLength(1);
    mock.channels[0].statusCb("CLOSED");
    mock.channels[0].statusCb("SUBSCRIBED");
    await flush();
    expect(mock.calls).toHaveLength(2);
  });

  test("unsubscribe removes the channel, is idempotent, and silences later events", async () => {
    const mock = useBackend(pagedServer([]));
    const cb = jest.fn();
    const unsub = onSnapshot(collection(db, "employees"), cb);
    await flush();
    const calls = cb.mock.calls.length;
    unsub();
    unsub();
    expect(mock.channels[0].removed).toBe(true);
    mock.channels[0].handlers[0]({ eventType: "INSERT", new: { id: "1", deleted_at: null } });
    expect(cb.mock.calls).toHaveLength(calls);
  });

  test("a failed fetch goes to the error callback", async () => {
    useBackend(() => ({ data: null, error: new Error("nope"), count: null }));
    const onError = jest.fn();
    onSnapshot(collection(db, "employees"), () => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "nope" }));
  });

  test("snapshots carry the truncated flag", async () => {
    useBackend(pagedServer([{ id: "1" }]));
    const cb = jest.fn();
    onSnapshot(collection(db, "employees"), cb);
    await flush();
    expect(cb.mock.calls[0][0].truncated).toBe(false);
  });

  test("document subscription refetches on change and unsubscribes", async () => {
    const mock = useBackend(() => ({ data: { id: "u1", name: "A" }, error: null }));
    const cb = jest.fn();
    const unsub = onSnapshot(doc(db, "users", "u1"), cb);
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    mock.channels[0].handlers[0]({});
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    expect(mock.channels[0].removed).toBe(true);
  });
});
