// src/hooks/useCollection.js
//
// One hook that powers every CRM list page. It:
//   - subscribes in real time (multi-session sync) via the shim's
//     onSnapshot, so any change in another tab/user shows up live
//   - applies branch scoping, free-text search, field filters,
//     sorting, and pagination — all in one consistent API
//
// Server-side note: this loads the collection and processes in the
// browser, which keeps the simple real-time model. For very large
// tables you'd switch to range()-based server pagination; see the
// audit document. For this app's scale it's the right tradeoff.

import { useEffect, useMemo, useState } from "react";
import { db, collection, onSnapshot } from "../firebase";
import { matchesBranch } from "../utils/branchFilter";

export function useCollection(name, {
  activeBranch = "all",
  search = "",
  searchFields = [],          // e.g. ["name", "studentId"]
  filters = {},               // e.g. { grade: "5", status: "paid" } ("" = ignore)
  filterFns = {},             // custom predicates: { dateFrom: (row,val)=>bool }
  sortBy = null,              // field name
  sortDir = "asc",            // "asc" | "desc"
  page = 1,
  pageSize = 25,
  branchScoped = true,        // apply matchesBranch?
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Real-time subscription. Refetches automatically on any change.
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, name),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(`useCollection(${name}) error:`, err);
        setLoading(false);
      }
    );
    return unsub;
  }, [name]);

  // Branch + search + filters (memoized).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branchScoped && !matchesBranch(row, activeBranch)) return false;

      if (q && searchFields.length) {
        const hit = searchFields.some((f) =>
          String(row[f] ?? "").toLowerCase().includes(q)
        );
        if (!hit) return false;
      }

      for (const [key, val] of Object.entries(filters)) {
        if (val === "" || val == null) continue;
        if (String(row[key] ?? "") !== String(val)) return false;
      }

      for (const [key, fn] of Object.entries(filterFns)) {
        const val = filters[key];
        if (val === "" || val == null) continue;
        if (!fn(row, val)) return false;
      }
      return true;
    });
  }, [rows, activeBranch, branchScoped, search, JSON.stringify(filters), searchFields.join(",")]);

  // Sorting.
  const sorted = useMemo(() => {
    if (!sortBy) return filtered;
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      let av = a[sortBy], bv = b[sortBy];
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") {
        return (an - bn) * dir;
      }
      av = String(av ?? "").toLowerCase();
      bv = String(bv ?? "").toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
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
    rows,                 // raw, unfiltered (for dropdown option lists)
    filtered: sorted,     // filtered + sorted, all pages
    paged,                // current page slice
    total,                // filtered count
    pageCount,
    page: safePage,
  };
}
