import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "../firebase";
import { useAuth } from "./AuthContext";
import { useUser } from "./UserContext";

const BranchContext = createContext();
export const useBranch = () => useContext(BranchContext);

// Workspaces
// ----------
// A workspace is the "space" the user is working in:
//   - HEAD_OFFICE ("head"): the head office. Users who can view all
//     branches see every branch consolidated here and can narrow the
//     view with the branch filter (all / head office only / one branch).
//   - a branch id: that branch on its own — only its data is shown and
//     new records are created in it.
//
// `activeBranch` is the *effective* data filter ("all" | "main" | branchId)
// derived from the workspace, so pages only need `matchesBranch(row, activeBranch)`.
//
// Users without canViewAllBranches are locked to their own branch (this
// mirrors branch_visible() in supabase/security.sql, which enforces it
// in the database).
export const HEAD_OFFICE = "head";

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

// "activeBranch" was the single pre-workspace setting: "all" | "main" | branchId.
const initialWorkspace = () => {
  const saved = read("workspace");
  if (saved) return saved;
  const legacy = read("activeBranch");
  return legacy && legacy !== "all" && legacy !== "main" ? legacy : HEAD_OFFICE;
};
const initialBranchFilter = () => {
  const saved = read("headBranchFilter");
  if (saved) return saved;
  return read("activeBranch") === "main" ? "main" : "all";
};

export function BranchProvider({ children }) {
  const [branches, setBranches] = useState([]);
  const [workspaceState, setWorkspaceState] = useState(initialWorkspace);
  const [branchFilterState, setBranchFilterState] = useState(initialBranchFilter);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { can, userProfile } = useUser();

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

  const canViewAll = can("canViewAllBranches");
  // Branch the user is confined to; "main" = no branch assigned (head office data only).
  const lockedBranch = canViewAll ? null : (userProfile?.branchId || "main");

  const branchExists = useCallback((id) => branches.some(b => b.id === id), [branches]);

  // Effective workspace. A saved branch that no longer exists falls back to head office.
  const workspace = lockedBranch
    ? (lockedBranch === "main" ? HEAD_OFFICE : lockedBranch)
    : (workspaceState !== HEAD_OFFICE && branchExists(workspaceState) ? workspaceState : HEAD_OFFICE);

  const isHeadOffice = workspace === HEAD_OFFICE;
  // The branch filter only applies inside head office, for users who can see all branches.
  const canFilterBranches = isHeadOffice && !lockedBranch;
  const branchFilter =
    branchFilterState === "all" || branchFilterState === "main" || branchExists(branchFilterState)
      ? branchFilterState
      : "all";

  // Effective data filter used by every page.
  const activeBranch = lockedBranch
    ? lockedBranch
    : isHeadOffice ? branchFilter : workspace;

  const branchName = useCallback((id) => {
    if (!id || id === "main") return "Head Office";
    return branches.find(b => b.id === id)?.name || "Unknown branch";
  }, [branches]);

  // Workspaces this user may switch into.
  const workspaces = useMemo(() => {
    if (lockedBranch) {
      return lockedBranch === "main"
        ? [{ id: HEAD_OFFICE, name: "Head Office", subtitle: "Head office records" }]
        : [{ id: lockedBranch, name: branchName(lockedBranch), subtitle: "Branch" }];
    }
    return [
      { id: HEAD_OFFICE, name: "Head Office", subtitle: "All branches" },
      ...branches.map(b => ({ id: b.id, name: b.name, subtitle: "Branch" })),
    ];
  }, [lockedBranch, branches, branchName]);

  const setWorkspace = useCallback((id) => {
    if (lockedBranch) return;
    setWorkspaceState(id);
    write("workspace", id);
    // Entering head office always starts from the consolidated view.
    if (id === HEAD_OFFICE) {
      setBranchFilterState("all");
      write("headBranchFilter", "all");
    }
  }, [lockedBranch]);

  const setBranchFilter = useCallback((id) => {
    setBranchFilterState(id);
    write("headBranchFilter", id);
  }, []);

  // Where new records should land by default / which branches can be assigned.
  // Head office view can assign any branch (or head office itself); a branch
  // workspace — or a locked user — can only assign its own branch.
  const defaultBranchId = activeBranch === "all" || activeBranch === "main" ? "" : activeBranch;
  const branchChoices = useMemo(
    () => (canFilterBranches ? branches : branches.filter(b => b.id === activeBranch)),
    [canFilterBranches, branches, activeBranch]
  );
  const canAssignHeadOffice = canFilterBranches || activeBranch === "main";

  const value = useMemo(
    () => ({
      branches, loading,
      workspaces, workspace, setWorkspace, isHeadOffice,
      canSwitchWorkspace: workspaces.length > 1,
      canFilterBranches, branchFilter, setBranchFilter,
      activeBranch, activeBranchName: activeBranch === "all" ? "All branches" : branchName(activeBranch),
      workspaceName: workspaces.find(w => w.id === workspace)?.name || "Head Office",
      branchName,
      defaultBranchId, branchChoices, canAssignHeadOffice,
    }),
    [branches, loading, workspaces, workspace, setWorkspace, isHeadOffice, canFilterBranches,
      branchFilter, setBranchFilter, activeBranch, branchName, defaultBranchId, branchChoices, canAssignHeadOffice]
  );

  return (
    <BranchContext.Provider value={value}>
      {loading && user ? null : children}
    </BranchContext.Provider>
  );
}
