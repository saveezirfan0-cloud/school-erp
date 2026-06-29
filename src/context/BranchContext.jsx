import React, { createContext, useContext, useState, useEffect } from "react";
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

  useEffect(() => {
    if (!user) {
      setBranches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "branches"),
      (snap) => {
        setBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Branches error:", error);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const setActiveBranch = (branchId) => {
    setActiveBranchState(branchId);
    localStorage.setItem("activeBranch", branchId);
  };

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setActiveBranch, loading }}>
      {loading && user ? null : children}
    </BranchContext.Provider>
  );
}