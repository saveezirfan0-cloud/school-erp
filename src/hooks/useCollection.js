// src/hooks/useCollection.js
//
// One hook that powers the CRM list pages. It:
//   - subscribes in real time (multi-session sync) via the shim's
//     onSnapshot, so any change in another tab/user shows up live
//   - applies branch scoping, free-text search, field filters,
//     sorting, and pagination — all in one consistent API
//
// Server-side note: this loads the whole collection (the shim pages through
// PostgREST until every row is fetched) and processes it in the browser.
// `truncated` is true if the shim's safety cap cut the data short; show a
// warning when it is. `error` is set when the subscription fails so pages
// can tell "no data" from "failed to load".

import { useEffect, useMemo, useRef, useState } from "react";
import { db, collection, onSnapshot } from "../firebase";
import { matchesBranch } from "../utils/branchFilter";

const isBlank = (v) => v === null || v === undefined || v === "";

// Sort comparator: blanks always last, numbers numerically, text
// case-insensitively; ties between numeric-looking values fall back to text.
export function compareForSort(av, bv, dir = 1) {
  const ab = isBlank(av), bb = isBlank(bv);
  if (ab && bb) return 0;
  if (ab) return 1;
  if (bb) return -1;
  const an = Number(av), bn = Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) {
    if (an !== bn) return (an - bn) * dir;
  }
  const as = String(av).toLowerCase();
  const bs = String(bv).toLowerCase();
  if (as < bs) return -1 * dir;
  if (as > bs) return 1 * dir;
  return 0;
}

export function useCollection(name, {
  activeBranch = "all",
  search = "",
  searchFields = [],          // e.g. ["name", "studentId"]
  filters = {},               // e.g. { grade: "5", status: "paid" } ("" = ignore);
                              // an array matches any of its values ([] = ignore)
  filterFns = {},             // custom predicates: { dateFrom: (row,val)=>bool }
  sortBy = null,              // field name
  sortDir = "asc",            // "asc" | "desc"
  page = 1,
  pageSize = 25,
  branchScoped = true,        // apply matchesBranch?
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [truncated, setTruncated] = useState(false);

  // Callers pass new object/array literals every render. Read the latest
  // values through refs and re-run the memo on a cheap serialised key, so
  // changed filters are never stale and the memo is not rebuilt each render.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const filterFnsRef = useRef(filterFns);
  filterFnsRef.current = filterFns;
  const searchFieldsRef = useRef(searchFields);
  searchFieldsRef.current = searchFields;
  const filtersKey = JSON.stringify(filters);
  const searchFieldsKey = searchFields.join(",");

  // Real-time subscription. Refetches automatically on any change.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      collection(db, name),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setTruncated(!!snap.truncated);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error(`useCollection(${name}) error:`, err);
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, [name]);

  // Branch + search + filters (memoized).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fields = searchFieldsRef.current;
    const flt = filtersRef.current;
    const fns = filterFnsRef.current;
    return rows.filter((row) => {
      if (branchScoped && !matchesBranch(row, activeBranch)) return false;

      if (q && fields.length) {
        const hit = fields.some((f) =>
          String(row[f] ?? "").toLowerCase().includes(q)
        );
        if (!hit) return false;
      }

      for (const [key, val] of Object.entries(flt)) {
        if (isBlank(val)) continue;
        // keys with a custom predicate (e.g. dateFrom/dateTo) are not row fields;
        // they are judged by that predicate below, never by equality.
        if (typeof fns[key] === "function") continue;
        if (Array.isArray(val)) {
          if (val.length === 0) continue;
          if (!val.some((v) => String(v) === String(row[key] ?? ""))) return false;
          continue;
        }
        if (String(row[key] ?? "") !== String(val)) return false;
      }

      for (const [key, fn] of Object.entries(fns)) {
        const val = flt[key];
        if (isBlank(val)) continue;
        if (!fn(row, val)) return false;
      }
      return true;
    });
    // filtersKey / searchFieldsKey stand in for the (re-created every render)
    // filters / searchFields objects; the refs above hold their latest values.
  }, [rows, activeBranch, branchScoped, search, filtersKey, searchFieldsKey]);

  // Sorting.
  const sorted = useMemo(() => {
    if (!sortBy) return filtered;
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => compareForSort(a[sortBy], b[sortBy], dir));
  }, [filtered, sortBy, sortDir]);

  // Pagination.
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  return {
    loading,
    error,                // null, or the error from the last failed load
    truncated,            // true if the shim's row safety cap cut the data short
    rows,                 // raw, unfiltered (for dropdown option lists)
    filtered: sorted,     // filtered + sorted, all pages
    paged,                // current page slice
    total,                // filtered count
    pageCount,
    page: safePage,
  };
}
