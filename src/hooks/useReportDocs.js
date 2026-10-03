import { useCallback, useEffect, useState } from "react";
import { listReportDocs } from "../lib/reportDocs";

// Loads report_docs of one kind. `available` is false when the table hasn't
// been created yet; `reload` refetches after a save.
export function useReportDocs(kind) {
  const [state, setState] = useState({ docs: [], available: true, loading: true });
  const reload = useCallback(async () => {
    try {
      const { docs, available } = await listReportDocs(kind);
      setState({ docs, available, loading: false });
    } catch (e) {
      console.warn("report_docs:", e?.message || e);
      setState({ docs: [], available: false, loading: false });
    }
  }, [kind]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
