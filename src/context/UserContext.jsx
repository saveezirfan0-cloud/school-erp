import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { db } from "../firebase";
import { doc, onSnapshot, collection } from "../firebase";
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
        snap.docs.forEach(d => {
          perms[d.id] = d.data().permissions || {};
        });
        setCustomRolePerms(perms);
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
  }), [userProfile, loadingProfile, role, permissions, customRolePerms, can, isAdmin, assignedBranchId]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}