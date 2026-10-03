import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { db, doc, onSnapshot, collection, updateDocs, setDoc, deleteDoc } from "../firebase";
import { ROLE_MENU_PREFIX, normalizePrefs } from "../config/menu";
import { useAuth } from "./AuthContext";

const UserContext = createContext();
export const useUser = () => useContext(UserContext);

export const ROLES = {
  ADMIN: "admin",
  BRANCH_MANAGER: "branch_manager",
  ACCOUNTANT: "accountant",
  FEE_COLLECTOR: "fee_collector",
};

export const PERMISSIONS = {
  admin: {
    canViewDashboard: true,
    canViewStudents: true,
    canEditStudents: true,
    canDeleteStudents: true,
    canViewEmployees: true,
    canEditEmployees: true,
    canDeleteEmployees: true,
    canViewFees: true,
    canEditFees: true,
    canViewExpenses: true,
    canEditExpenses: true,
    canDeleteExpenses: true,
    canViewPayments: true,
    canEditPayments: true,
    canViewPayslips: true,
    canEditPayslips: true,
    canViewAccounting: true,
    canEditAccounting: true,
    canViewReports: true,
    canExport: true,
    canManageBranches: true,
    canManageUsers: true,
    canViewAllBranches: true,
  },
  branch_manager: {
    canViewDashboard: true,
    canViewStudents: true,
    canEditStudents: true,
    canDeleteStudents: false,
    canViewEmployees: true,
    canEditEmployees: false,
    canDeleteEmployees: false,
    canViewFees: true,
    canEditFees: true,
    canViewExpenses: true,
    canEditExpenses: true,
    canDeleteExpenses: false,
    canViewPayments: true,
    canEditPayments: true,
    canViewPayslips: true,
    canEditPayslips: false,
    canViewAccounting: false,
    canEditAccounting: false,
    canViewReports: false,
    canExport: false,
    canManageBranches: false,
    canManageUsers: false,
    canViewAllBranches: false,
  },
  accountant: {
    canViewDashboard: true,
    canViewStudents: false,
    canEditStudents: false,
    canDeleteStudents: false,
    canViewEmployees: false,
    canEditEmployees: false,
    canDeleteEmployees: false,
    canViewFees: true,
    canEditFees: true,
    canViewExpenses: true,
    canEditExpenses: true,
    canDeleteExpenses: false,
    canViewPayments: true,
    canEditPayments: true,
    canViewPayslips: true,
    canEditPayslips: true,
    canViewAccounting: true,
    canEditAccounting: true,
    canViewReports: true,
    canExport: false,
    canManageBranches: false,
    canManageUsers: false,
    canViewAllBranches: true,
  },
  fee_collector: {
    canViewDashboard: false,
    canViewStudents: true,
    canEditStudents: false,
    canDeleteStudents: false,
    canViewEmployees: false,
    canEditEmployees: false,
    canDeleteEmployees: false,
    canViewFees: true,
    canEditFees: true,
    canViewExpenses: false,
    canEditExpenses: false,
    canDeleteExpenses: false,
    canViewPayments: false,
    canEditPayments: false,
    canViewPayslips: false,
    canEditPayslips: false,
    canViewAccounting: false,
    canEditAccounting: false,
    canViewReports: false,
    canExport: false,
    canManageBranches: false,
    canManageUsers: false,
    canViewAllBranches: false,
  },
};

export function UserProvider({ children }) {
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [customRolePerms, setCustomRolePerms] = useState({});
  // Admin-set default menus per role, stored as custom_roles rows with a
  // reserved "menu:" id so no schema change is needed.
  const [roleMenuDefaults, setRoleMenuDefaults] = useState({});

  // Load user profile from Firestore
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setLoadingProfile(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (snap.exists()) {
          setUserProfile({ id: snap.id, ...snap.data() });
        } else {
          // First user / no profile — default to admin
          setUserProfile({
            id: user.uid,
            email: user.email,
            role: "admin",
            name: user.email,
          });
        }
        setLoadingProfile(false);
      },
      (error) => {
        console.error("UserContext error:", error);
        // On error default to admin so app doesn't break
        setUserProfile({
          id: user.uid,
          email: user.email,
          role: "admin",
          name: user.email,
        });
        setLoadingProfile(false);
      }
    );

    return unsub;
  }, [user]);

  // Load custom role permissions from Firestore
  useEffect(() => {
    if (!user) return;

    const unsub = onSnapshot(
      collection(db, "customRoles"),
      (snap) => {
        const perms = {};
        const menus = {};
        snap.docs.forEach(d => {
          if (d.id.startsWith(ROLE_MENU_PREFIX)) {
            const layout = d.data().menuLayout;
            if (layout) menus[d.id.slice(ROLE_MENU_PREFIX.length)] = layout;
            return;
          }
          perms[d.id] = d.data().permissions || {};
        });
        setCustomRolePerms(perms);
        setRoleMenuDefaults(menus);
      },
      (error) => {
        console.error("Custom roles error:", error);
      }
    );

    return unsub;
  }, [user]);

  // Resolve permissions — role defaults, then per-user overrides.
  const role = userProfile?.role || "admin";
  const basePermissions = PERMISSIONS[role] || customRolePerms[role] || PERMISSIONS.admin;

  // Per-user overrides (set in Access Overview) win over the role
  // default. Admins are always full-access regardless of overrides.
  const permissions = React.useMemo(() => {
    if (role === "admin") return PERMISSIONS.admin;
    const overrides = userProfile?.pagePermissions || {};
    return { ...basePermissions, ...overrides };
  }, [role, basePermissions, userProfile]);

  // Helper — check a single permission
  const can = useCallback((permission) => {
    if (!permission) return true;
    return permissions[permission] === true;
  }, [permissions]);

  const isAdmin = role === "admin";

  // Menu: a user's own layout wins, then the default an admin set for
  // their role, then the built-in default (null). updateDocs merges into
  // `extra`, so these never overwrite pagePermissions (plain updateDoc would).
  const ownMenuLayout = userProfile?.menuLayout || null;
  const roleMenuLayout = roleMenuDefaults[role] || null;
  const menuLayout = ownMenuLayout || roleMenuLayout;
  const menuPrefs = useMemo(() => normalizePrefs(userProfile?.menuPrefs), [userProfile?.menuPrefs]);

  const saveProfileExtra = useCallback(async (key, value) => {
    if (!userProfile?.id) return;
    const previous = userProfile[key] ?? null;
    setUserProfile((p) => (p ? { ...p, [key]: value } : p));
    try {
      await updateDocs("users", [userProfile.id], { [key]: value });
    } catch (e) {
      setUserProfile((p) => (p ? { ...p, [key]: previous } : p));
      throw e;
    }
  }, [userProfile]);

  // layout === null resets to the role/built-in default
  const saveMenuLayout = useCallback((layout) => saveProfileExtra("menuLayout", layout), [saveProfileExtra]);

  // Preferences (pins, collapsed sections) change often: update the UI at
  // once and batch the network write.
  const prefsTimer = React.useRef(null);
  const saveMenuPrefs = useCallback((next) => {
    if (!userProfile?.id) return;
    const id = userProfile.id;
    setUserProfile((p) => (p ? { ...p, menuPrefs: next } : p));
    clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => {
      updateDocs("users", [id], { menuPrefs: next }).catch((e) => console.error("menuPrefs save failed:", e));
    }, 600);
  }, [userProfile?.id]);

  // Admin only (RLS enforces it): set or clear the default menu for a role.
  const saveRoleMenuDefault = useCallback(async (roleId, layout) => {
    const ref = doc(db, "customRoles", ROLE_MENU_PREFIX + roleId);
    if (layout) await setDoc(ref, { menuLayout: layout });
    else await deleteDoc(ref);
  }, []);

  // If branch_manager, restrict to their assigned branch
  const assignedBranchId = role === "branch_manager" ? userProfile?.branchId : null;

  const value = useMemo(() => ({
    userProfile,
    loadingProfile,
    role,
    permissions,
    customRolePerms,
    can,
    isAdmin,
    assignedBranchId,
    menuLayout,
    ownMenuLayout,
    roleMenuLayout,
    roleMenuDefaults,
    saveMenuLayout,
    saveRoleMenuDefault,
    menuPrefs,
    saveMenuPrefs,
  }), [userProfile, loadingProfile, role, permissions, customRolePerms, can, isAdmin, assignedBranchId, menuLayout, ownMenuLayout, roleMenuLayout, roleMenuDefaults, saveMenuLayout, saveRoleMenuDefault, menuPrefs, saveMenuPrefs]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}