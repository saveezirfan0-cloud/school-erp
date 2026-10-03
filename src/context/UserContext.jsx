import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { db } from "../firebase";
import { doc, onSnapshot, collection } from "../firebase";
import { useAuth } from "./AuthContext";
import { firstPermittedRoute, DELETE_PERMISSIONS } from "./routeAccess";

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
    canDeleteFees: true,
    canDeletePayslips: true,
    canDeletePayments: true,
    canDeleteJournals: true,
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
    canDeleteFees: false,
    canDeletePayslips: false,
    canDeletePayments: false,
    canDeleteJournals: false,
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
    canDeleteFees: false,
    canDeletePayslips: false,
    canDeletePayments: false,
    canDeleteJournals: false,
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
    canDeleteFees: false,
    canDeletePayslips: false,
    canDeletePayments: false,
    canDeleteJournals: false,
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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Every permission key, all false. Anything that cannot be resolved to a
// known role gets exactly this (fail closed).
export const NO_PERMISSIONS = Object.freeze(
  Object.keys(PERMISSIONS.admin).reduce((acc, k) => ({ ...acc, [k]: false }), {})
);

export const isBuiltinRole = (role) => typeof role === "string" && hasOwn(PERMISSIONS, role);

// Pure resolver: role defaults, then per-user overrides.
// - no profile / no role / unknown role / custom role not (yet) loaded -> nothing
// - admin always gets everything and ignores overrides
// Overrides are applied in the browser only; the database does not read
// them yet (see AccessOverview).
export function resolvePermissions(profile, customRolePerms) {
  const role = profile?.role;
  if (!profile || typeof role !== "string" || !role) return NO_PERMISSIONS;
  if (role === "admin") return PERMISSIONS.admin;

  let base = null;
  if (isBuiltinRole(role)) base = PERMISSIONS[role];
  else if (hasOwn(customRolePerms, role)) base = { ...NO_PERMISSIONS, ...customRolePerms[role] };
  if (!base) return NO_PERMISSIONS;

  const overrides = {};
  const raw = profile.pagePermissions;
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (hasOwn(NO_PERMISSIONS, k) && typeof v === "boolean") overrides[k] = v;
    }
  }
  return { ...base, ...overrides };
}

export function UserProvider({ children }) {
  const { user } = useAuth();
  // State is keyed by the auth uid it was loaded for, so a stale result
  // from a previous user (or the render between "signed in" and "profile
  // requested") is never treated as the current user's profile.
  const [profileState, setProfileState] = useState({ uid: null, profile: null, error: null });
  const [rolesState, setRolesState] = useState({ uid: null, perms: {}, error: null });

  useEffect(() => {
    if (!user) return undefined;
    const uid = user.uid;
    const unsub = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        // Missing profile => NO access (the account may have been removed).
        setProfileState({
          uid,
          profile: snap.exists() ? { id: snap.id, ...snap.data() } : null,
          error: null,
        });
      },
      (error) => {
        console.error("UserContext error:", error);
        setProfileState({ uid, profile: null, error });
      }
    );
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const uid = user.uid;
    const unsub = onSnapshot(
      collection(db, "customRoles"),
      (snap) => {
        const perms = {};
        snap.docs.forEach((d) => { perms[d.id] = d.data().permissions || {}; });
        setRolesState({ uid, perms, error: null });
      },
      (error) => {
        console.error("Custom roles error:", error);
        setRolesState({ uid, perms: {}, error });
      }
    );
    return unsub;
  }, [user]);

  const profileReady = !!user && profileState.uid === user.uid;
  const rolesReady = !!user && rolesState.uid === user.uid;
  const userProfile = profileReady ? profileState.profile : null;
  const profileError = profileReady ? profileState.error : null;
  const customRolePerms = useMemo(() => (rolesReady ? rolesState.perms : {}), [rolesReady, rolesState]);

  const role = userProfile?.role || null;
  // Custom-role users must wait for the roles table; built-in roles don't.
  const loadingProfile = !!user && (!profileReady || (!!role && !isBuiltinRole(role) && !rolesReady));

  const permissions = useMemo(
    () => resolvePermissions(userProfile, customRolePerms),
    [userProfile, customRolePerms]
  );

  const roleKnown = !!role && (isBuiltinRole(role) || hasOwn(customRolePerms, role));
  const homeRoute = firstPermittedRoute(permissions);

  // Why the user has no access (null when they do).
  let accessProblem = null;
  if (!loadingProfile && user) {
    if (profileError) accessProblem = "error";
    else if (!userProfile) accessProblem = "no-profile";
    else if (!roleKnown) accessProblem = "unknown-role";
    else if (!homeRoute) accessProblem = "no-permissions";
  }

  // Check a single permission. No argument means "no gate".
  const can = useCallback((permission) => {
    if (!permission) return true;
    return permissions[permission] === true;
  }, [permissions]);

  const canAny = useCallback(
    (...list) => list.flat().some((p) => permissions[p] === true),
    [permissions]
  );
  const canDeleteAny = DELETE_PERMISSIONS.some((p) => permissions[p] === true);

  const isAdmin = roleKnown && role === "admin";

  // Anyone without "view all branches" is limited to their own branch
  // (this mirrors branch_visible() in the database).
  const assignedBranchId =
    roleKnown && !permissions.canViewAllBranches && userProfile?.branchId ? userProfile.branchId : null;

  const value = useMemo(() => ({
    userProfile,
    loadingProfile,
    profileError,
    accessProblem,
    hasAccess: !loadingProfile && !!user && accessProblem === null,
    homeRoute,
    role,
    permissions,
    customRolePerms,
    can,
    canAny,
    canDeleteAny,
    isAdmin,
    assignedBranchId,
  }), [userProfile, loadingProfile, profileError, accessProblem, user, homeRoute, role, permissions,
    customRolePerms, can, canAny, canDeleteAny, isAdmin, assignedBranchId]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}
