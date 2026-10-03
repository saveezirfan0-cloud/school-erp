// src/hooks/useReportData.js
//
// Loads whole collections for the report pages and tells the page when a
// result cannot be trusted: a failed query (reported, never treated as
// "no rows") and a query that returned exactly the platform row cap
// (probably truncated). Pages show both via <DataWarnings />.

import { useCallback, useEffect, useState } from "react";
import { db, collection, getDocs } from "../firebase";
import { isCapped } from "../utils/reporting";

export function useReportData(names, enabled = true) {
  const key = names.join(",");
  const [state, setState] = useState({ data: {}, loading: enabled, errors: {}, capped: [] });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.allSettled(names.map((n) => getDocs(collection(db, n)))).then((results) => {
      if (cancelled) return;
      const data = {}, errors = {}, capped = [];
      results.forEach((r, i) => {
        const n = names[i];
        if (r.status === "fulfilled") {
          data[n] = r.value.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (isCapped(r.value.size)) capped.push(n);
        } else {
          data[n] = [];
          errors[n] = r.reason?.message || "Could not load";
          console.error(`useReportData(${n}) failed:`, r.reason);
        }
      });
      setState({ data, loading: false, errors, capped });
    });
    return () => { cancelled = true; };
  }, [key, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
