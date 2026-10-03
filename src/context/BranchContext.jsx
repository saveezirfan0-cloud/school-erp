import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "../firebase";
import { useAuth } from "./AuthContext";

const BranchContext = createContext();
export const useBranch = () => useContext(BranchContext);

export function BranchProvider({ children }) {
  const [branches, setBranches] = useState([]);
  const [activeBranch, setActiveBranchState] = useState(
    () => localStorage.getItem("activeBranch") || "all"
  );
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const hadUser = useRef(false);

  useEffect(() => {
    if (!user) {
      setBranches([]);
      setLoading(false);
      // Don't leak one person's branch choice to the next sign-in on a
      // shared machine (only on a real sign-out, not the initial load).
      if (hadUser.current) {
        hadUser.current = false;
        setActiveBranchState("all");
        try { localStorage.removeItem("activeBranch"); } catch { /* ignore */ }
      }
      return;
    }
    hadUser.current = true;
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "branches"),
      (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Safety net: if the data ever contains duplicate branch names,
        // show each name only once (keep the first). The real fix is the
        // unique constraint in fix_duplicate_branches.sql, but this keeps
        // the UI clean regardless.
        const seen = new Set();
        const unique = all.filter(b => {
          const key = (b.name || "").trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setBranches(unique);
        setLoading(false);
      },
      (error) => {
        console.error("Branches error:", error);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const setActiveBranch = useCallback((branchId) => {
    setActiveBranchState(branchId);
    localStorage.setItem("activeBranch", branchId);
  }, []);

  const value = useMemo(
    () => ({ branches, activeBranch, setActiveBranch, loading }),
    [branches, activeBranch, setActiveBranch, loading]
  );

  return (
    <BranchContext.Provider value={value}>
      {loading && user ? null : children}
    </BranchContext.Provider>
  );
}