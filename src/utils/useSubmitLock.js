// src/utils/useSubmitLock.js
//
// Double-submit guard for every action that posts money (ACC-09).
// A disabled button alone is not enough: two clicks can land before
// React re-renders. The ref flips synchronously, so the second call is
// ignored immediately; `busy` drives the disabled state / spinner.
//
//   const { busy, run } = useSubmitLock();
//   const onSave = () => run(async () => { ...post money... });
//   <button disabled={busy}>Save</button>
//
// run() resolves to undefined (and does nothing) while another run is
// in flight.

import { useCallback, useRef, useState } from "react";

export function useSubmitLock() {
  const lockRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn) => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run, isLocked: () => lockRef.current };
}

export default useSubmitLock;
