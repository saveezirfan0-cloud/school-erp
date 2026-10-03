// src/hooks/usePersistentState.js
//
// useState that remembers its value in localStorage, so a choice
// (a filter, a last-picked option) survives page reloads. Falls back to
// plain in-memory state when storage is unavailable.

import { useState, useCallback } from "react";

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch { /* storage unavailable or corrupt value */ }
    return initial;
  });

  const set = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
      return v;
    });
  }, [key]);

  return [value, set];
}
