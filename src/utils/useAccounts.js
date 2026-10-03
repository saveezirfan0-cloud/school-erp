// src/utils/useAccounts.js
//
// Live account list WITH its load state, so money pages can tell
// "no accounts exist" from "the list could not be read" and show it,
// instead of silently skipping the ledger (ACC-01).

import { useEffect, useMemo, useState } from "react";
import { db, collection, onSnapshot } from "../firebase";
import { bankCashAccounts, describeAccountsProblem } from "./accounting";

export function useAccounts() {
  const [state, setState] = useState({ accounts: [], status: "loading" });

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "accounts"),
      (snap) => setState({ accounts: snap.docs.map((d) => ({ id: d.id, ...d.data() })), status: "ready" }),
      () => setState({ accounts: [], status: "error" })
    );
    return unsub;
  }, []);

  const postable = useMemo(() => bankCashAccounts(state.accounts), [state.accounts]);
  const problem = describeAccountsProblem(state.accounts, state.status);

  return { accounts: state.accounts, postable, status: state.status, problem, canPost: postable.length > 0 };
}

export default useAccounts;
