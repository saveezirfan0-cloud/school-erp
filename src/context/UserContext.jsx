import React, { createContext, useContext, useEffect, useState } from "react";
import { db } from "../firebase";
import { doc, onSnapshot, collection } from "firebase/firestore";
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

  // Resolve permissions — check built-in first, then custom roles
  const role = userProfile?.role || "admin";
  const permissions = PERMISSIONS[role] || customRolePerms[role] || PERMISSIONS.admin;

  // Helper — check a single permission
  const can = (permission) => {
    if (!permission) return true;
    return permissions[permission] === true;
  };

  const isAdmin = role === "admin";

  // If branch_manager, restrict to their assigned branch
  const assignedBranchId = role === "branch_manager" ? userProfile?.branchId : null;

  return (
    <UserContext.Provider value={{
      userProfile,
      loadingProfile,
      role,
      permissions,
      customRolePerms,
      can,
      isAdmin,
      assignedBranchId,
    }}>
      {children}
    </UserContext.Provider>
  );
}