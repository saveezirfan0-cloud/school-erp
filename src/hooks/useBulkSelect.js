// src/hooks/useBulkSelect.js
//
// Multi-select state for list pages (bulk edit / bulk delete).
//
// Pass in the ids the selection is allowed to contain — normally the
// *filtered* rows, all pages. The hook automatically prunes ids that
// disappear (deleted in another session, filtered out, etc.), so a
// bulk action can never touch a row the user can no longer see.

import { useEffect, useMemo, useState } from "react";

export function useBulkSelect(validIds = []) {
  const [selected, setSelected] = useState(() => new Set());

  // Stable key so the prune effect only runs when the id set changes.
  const validKey = useMemo(() => validIds.join("\u0000"), [validIds]);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(validIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [validKey]);

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
