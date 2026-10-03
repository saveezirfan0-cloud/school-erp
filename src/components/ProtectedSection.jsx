import React from "react";
import { useUser } from "../context/UserContext";

// Renders children only when the current user holds the permission(s).
//
//   <ProtectedSection permission="canDeleteStudents">...</ProtectedSection>
//   <ProtectedSection anyOf={["canEditFees", "canEditPayments"]}>...</ProtectedSection>
//
// This hides UI only. The database is still the real gate, so keep
// handlers defensive too: `const { can } = useUser(); if (!can("canExport")) return;`
export default function ProtectedSection({ permission, anyOf, fallback = null, children }) {
  const { can, canAny } = useUser();
  if (permission && !can(permission)) return fallback;
  if (anyOf && !canAny(anyOf)) return fallback;
  return children;
}
