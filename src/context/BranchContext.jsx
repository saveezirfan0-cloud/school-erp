import React, { createContext, useContext, useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

const BranchContext = createContext();
export const useBranch = () => useContext(BranchContext);

export function BranchProvider({ children }) {
  const [branches, setBranches] = useState([]);
  const [activeBranch, setActiveBranch] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "branches"), (snap) => {
      setBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setActiveBranch, loading }}>
      {loading ? null : children}
    </BranchContext.Provider>
  );
}