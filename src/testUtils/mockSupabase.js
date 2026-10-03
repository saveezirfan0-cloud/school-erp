// Test helper: a chainable stand-in for the supabase-js query builder.
//
// Every builder method just records itself and returns the builder; awaiting
// the builder calls `handler(record)` where record = { table, ops } and ops is
// [[method, args], ...] in call order. The handler returns { data, error,
// count } (or a promise of it).

export function createMockSupabase(handler) {
  const calls = [];

  function from(table) {
    const record = { table, ops: [] };
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          return (resolve, reject) => {
            calls.push(record);
            let out;
            try { out = Promise.resolve(handler(record)); } catch (e) { out = Promise.reject(e); }
            return out.then(resolve, reject);
          };
        }
        return (...args) => {
          record.ops.push([prop, args]);
          return builder;
        };
      },
    });
    return builder;
  }

  const channels = [];
  function channel(name) {
    const ch = {
      name,
      handlers: [],
      statusCb: null,
      removed: false,
      on(_type, _filter, cb) { ch.handlers.push(cb); return ch; },
      subscribe(cb) { ch.statusCb = cb || null; return ch; },
    };
    channels.push(ch);
    return ch;
  }
  const removeChannel = (ch) => { ch.removed = true; };

  return { from, channel, removeChannel, calls, channels };
}

// ---- helpers for reading recorded calls ----
export const opsOf = (record, method) => record.ops.filter(([m]) => m === method);
export const hasOp = (record, method) => opsOf(record, method).length > 0;
export const firstArgs = (record, method) => (opsOf(record, method)[0] || [])[1];

/**
 * A fake PostgREST table: serves .range(from, to) over `rows`, never
 * returning more than `maxRows` per response (like the real max-rows), and
 * reports the full `count`.
 */
export function pagedServer(rows, { maxRows = 1000 } = {}) {
  return (record) => {
    const range = firstArgs(record, "range");
    if (!range) return { data: rows.slice(0, maxRows), error: null, count: rows.length };
    const [from, to] = range;
    if (from >= rows.length && rows.length > 0) {
      return { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null };
    }
    const end = Math.min(to, from + maxRows - 1);
    return { data: rows.slice(from, end + 1), error: null, count: rows.length };
  };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
