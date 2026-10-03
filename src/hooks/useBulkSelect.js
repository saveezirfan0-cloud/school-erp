// src/hooks/useBulkSelect.js
//
// Multi-select state for list pages (bulk edit / bulk delete).
//
// Pass in the ids the selection is allowed to contain — normally ALL rows
// of the collection, not the filtered ones, so ticking rows, then changing
// the search/filters and ticking more keeps the earlier ticks. The hook
// prunes ids that no longer exist (deleted in another session, etc.).
//
// `resetKey` (optional): when it changes (e.g. the active branch), the
// selection is cleared so a bulk action can't touch rows from a scope the
// user has switched away from.

import { useEffect, useMemo, useRef, useState } from "react";

export function useBulkSelect(validIds = [], resetKey = null) {
  const [selected, setSelected] = useState(() => new Set());

  // Latest ids, readable from the effect without making it re-run on
  // every render (callers pass a fresh array each time).
  const validIdsRef = useRef(validIds);
  validIdsRef.current = validIds;

  // Stable key so the prune effect only runs when the id set changes.
  const validKey = useMemo(() => validIds.join("\u0000"), [validIds]);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(validIdsRef.current);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [validKey]);

  useEffect(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, [resetKey]);

  const isSelected = (id) => selected.has(id);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Header checkbox behaviour for the current page: if every visible
  // row is selected, unselect them; otherwise select them all
  // (leaving selections on other pages untouched).
  const togglePage = (pageIds) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      if (allOn) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  // "Select all N filtered" (across every page).
  const selectAll = (ids) => setSelected(new Set(ids));

  const clear = () => setSelected(new Set());

  const pageChecked = (pageIds) =>
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageIndeterminate = (pageIds) =>
    !pageChecked(pageIds) && pageIds.some((id) => selected.has(id));

  return {
    selected,               // Set of ids
    count: selected.size,
    isSelected,
    toggle,
    togglePage,
    selectAll,
    clear,
    pageChecked,
    pageIndeterminate,
  };
}
